// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cli/dev`
 * Purpose: `cogni dev` command — wires runtime detection, the local HTTP server, the Cloudflare tunnel, and the browser open into one foreground command.
 * Scope: Command orchestration only. Does not contain HTTP server, tunnel, or subprocess logic — that work is delegated to sibling modules.
 * Invariants:
 *   - The command exits non-zero if no runtime (claude or codex) is detected, unless `--allow-empty` is passed (kept undocumented; for tests).
 *   - On Ctrl-C, both the local server and `cloudflared` are stopped before the process exits.
 *   - The studio URL printed to stdout has the tunnel URL embedded as `?baseUrl=…` so the browser knows which device to talk to.
 * Side-effects: IO (subprocesses, network listener, opens browser)
 * Links: src/dev/server.ts, src/dev/tunnel.ts, src/dev/runtime.ts
 * @public
 */

import { spawn } from "node:child_process";

import { detectRuntimes } from "./runtime.js";
import { startServer } from "./server.js";
import { startTunnel } from "./tunnel.js";

interface DevOptions {
  host: string;
  port: number;
  workdir: string;
  open: boolean;
  tunnel: boolean;
  printUrlOnly: boolean;
  allowEmpty: boolean;
}

function parseArgs(argv: string[]): DevOptions {
  const opts: DevOptions = {
    host: "test.cognidao.org",
    port: 0,
    workdir: process.cwd(),
    open: true,
    tunnel: true,
    printUrlOnly: false,
    allowEmpty: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--host") opts.host = mustNext(argv, ++i, "--host");
    else if (arg === "--port")
      opts.port = Number(mustNext(argv, ++i, "--port"));
    else if (arg === "--workdir")
      opts.workdir = mustNext(argv, ++i, "--workdir");
    else if (arg === "--no-open") opts.open = false;
    else if (arg === "--no-tunnel") opts.tunnel = false;
    else if (arg === "--print-url-only") {
      opts.printUrlOnly = true;
      opts.open = false;
    } else if (arg === "--allow-empty") opts.allowEmpty = true;
    else throw new Error(`unknown flag: ${arg}`);
  }
  if (Number.isNaN(opts.port)) throw new Error("--port must be a number");
  return opts;
}

function mustNext(argv: string[], i: number, flag: string): string {
  const v = argv[i];
  if (v === undefined) throw new Error(`${flag} requires a value`);
  return v;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // best-effort; fall through and let the user copy the URL.
  }
}

function buildAllowedOrigins(host: string): string[] {
  const origins = new Set<string>();
  origins.add(`https://${host}`);
  // Allow the canonical operator host trio in addition to whatever was passed,
  // so the same `cogni dev` session can be steered across environments by
  // visiting any of them.
  origins.add("https://test.cognidao.org");
  origins.add("https://preview.cognidao.org");
  origins.add("https://cognidao.org");
  origins.add("http://localhost:3000");
  return [...origins];
}

export async function runDev(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);

  const runtimes = await detectRuntimes();
  const installed = runtimes.filter((r) => r.installed);
  if (installed.length === 0 && !opts.allowEmpty) {
    process.stderr.write(
      "cogni dev: no agent runtime detected. Install Claude Code (https://claude.ai/code) or the OpenAI Codex CLI before running.\n"
    );
    return 2;
  }

  const server = await startServer({
    port: opts.port,
    workdir: opts.workdir,
    runtimes,
    allowedOrigins: buildAllowedOrigins(opts.host),
  });

  process.stdout.write(
    `cogni dev: local server on http://127.0.0.1:${server.port}\n`
  );
  process.stdout.write(`cogni dev: workdir = ${opts.workdir}\n`);
  for (const r of runtimes) {
    process.stdout.write(
      `  ${r.installed ? "✓" : "✗"} ${r.kind}${r.version ? ` (${r.version})` : ""}\n`
    );
  }

  let publicUrl: string;
  let tunnelChild: { kill: (signal?: NodeJS.Signals) => boolean } | null = null;
  if (opts.tunnel) {
    process.stdout.write(`cogni dev: starting Cloudflare quick tunnel…\n`);
    const handle = await startTunnel({ localPort: server.port });
    publicUrl = handle.url;
    tunnelChild = handle.child;
    process.stdout.write(`cogni dev: tunnel = ${publicUrl}\n`);
  } else {
    publicUrl = `http://127.0.0.1:${server.port}`;
    process.stdout.write(`cogni dev: tunnel disabled; using ${publicUrl}\n`);
  }

  const studioUrl = `https://${opts.host}/runtimes/dev?baseUrl=${encodeURIComponent(publicUrl)}`;
  process.stdout.write(
    `\ncogni dev: open this URL to chat with your local runtime:\n  ${studioUrl}\n\n`
  );

  if (opts.open) openBrowser(studioUrl);

  await new Promise<void>((resolve) => {
    const shutdown = (signal: NodeJS.Signals): void => {
      process.stdout.write(`\ncogni dev: ${signal} received, shutting down…\n`);
      try {
        tunnelChild?.kill("SIGTERM");
      } catch {
        // ignore
      }
      void server.close().then(() => resolve());
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  });

  return 0;
}
