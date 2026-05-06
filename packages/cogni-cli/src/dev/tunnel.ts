// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cli/dev/tunnel`
 * Purpose: Spawn `cloudflared tunnel --url …` and resolve the public `*.trycloudflare.com` URL.
 * Scope: Subprocess management for the tunnel only. Does not own the local HTTP server or runtime spawning.
 * Invariants:
 *   - Resolves on the first matching URL emitted on stdout/stderr; never assumes a fixed line ordering.
 *   - Caller is responsible for killing the returned child on shutdown; this module does not register signal handlers.
 * Side-effects: IO (spawns `cloudflared`)
 * Links: docs/research/byo-agent-runtime-bridge.md
 * @public
 */

import { spawn, type ChildProcess } from "node:child_process";

const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** Pure parser exported for tests. */
export function parseTunnelUrl(line: string): string | null {
  const match = line.match(TUNNEL_URL_RE);
  return match ? match[0] : null;
}

export interface TunnelHandle {
  url: string;
  child: ChildProcess;
  /** Promise that resolves when the cloudflared subprocess exits. */
  exited: Promise<number>;
}

export interface StartTunnelOptions {
  localPort: number;
  /** Total time to wait for the URL to appear before aborting. */
  timeoutMs?: number;
  /** Override binary (test seam). */
  command?: string;
}

export async function startTunnel(
  opts: StartTunnelOptions
): Promise<TunnelHandle> {
  const command = opts.command ?? "cloudflared";
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const child = spawn(
    command,
    ["tunnel", "--url", `http://127.0.0.1:${opts.localPort}`],
    {
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const exited = new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 0));
  });

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(`cloudflared did not emit a tunnel URL within ${timeoutMs}ms`)
      );
    }, timeoutMs);

    const onChunk = (buf: Buffer): void => {
      const found = parseTunnelUrl(buf.toString("utf8"));
      if (found) {
        clearTimeout(timer);
        child.stdout.off("data", onChunk);
        child.stderr.off("data", onChunk);
        resolve(found);
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `cloudflared exited (code=${code ?? 0}) before emitting a URL`
        )
      );
    });
  });

  return { url, child, exited };
}
