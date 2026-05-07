// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cli/dev/server`
 * Purpose: Local HTTP server exposed by `cogni dev`. Accepts chat requests from the operator's `/runtimes/dev` page (proxied through a Cloudflare quick tunnel) and shells out to the user's local `claude` / `codex` binary.
 * Scope: HTTP only. Does not handle tunneling and does not own subprocess details — those live in sibling modules.
 * Invariants:
 *   - CORS allow-list is restricted to the configured operator origins; `*` is never set.
 *   - `/run` streams output as Server-Sent Events; each event is a JSON envelope with `stream` ("stdout" | "stderr" | "done") and `data`.
 *   - The server binds to 127.0.0.1 only; the only way it becomes publicly addressable is via the Cloudflare tunnel started by the parent CLI.
 * Side-effects: IO (HTTP listener, spawns subprocesses via runtime module)
 * Links: src/dev/runtime.ts
 * @public
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { type Runtime, type RuntimeKind, runOnce } from "./runtime.js";
import type { SpawnEnv } from "./session.js";

export interface ServerOptions {
  port: number;
  /** Sanitized cwd + env that every spawned agent inherits. Provisioned by `session.provisionSession`. */
  spawnEnv: SpawnEnv;
  runtimes: Runtime[];
  allowedOrigins: string[];
}

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

interface RunBody {
  prompt: string;
  runtime: RuntimeKind;
}

function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  allowed: string[]
): void {
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function jsonResponse(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function parseRunBody(raw: string): RunBody | { error: string } {
  if (!raw) return { error: "empty body" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "invalid JSON" };
  }
  if (!parsed || typeof parsed !== "object")
    return { error: "expected object" };
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.prompt !== "string" || obj.prompt.length === 0) {
    return { error: "missing or empty `prompt`" };
  }
  if (obj.runtime !== "claude" && obj.runtime !== "codex") {
    return { error: "`runtime` must be 'claude' or 'codex'" };
  }
  return { prompt: obj.prompt, runtime: obj.runtime };
}

function sseEvent(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function startServer(opts: ServerOptions): Promise<ServerHandle> {
  const installedKinds = new Set(
    opts.runtimes.filter((r) => r.installed).map((r) => r.kind)
  );

  const server = createServer((req, res) => {
    applyCors(req, res, opts.allowedOrigins);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/healthz") {
      jsonResponse(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url === "/capabilities") {
      jsonResponse(res, 200, {
        runtimes: opts.runtimes.map((r) => ({
          kind: r.kind,
          installed: r.installed,
          version: r.version ?? null,
        })),
        workdir: opts.spawnEnv.cwd,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/run") {
      void handleRun(req, res, opts.spawnEnv, installedKinds);
      return;
    }

    jsonResponse(res, 404, { error: "not_found" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: opts.port }, () => resolve());
  });

  const addr = server.address() as AddressInfo;
  return {
    port: addr.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function handleRun(
  req: IncomingMessage,
  res: ServerResponse,
  spawnEnv: SpawnEnv,
  installed: Set<RuntimeKind>
): Promise<void> {
  const body = parseRunBody(await readBody(req));
  if ("error" in body) {
    jsonResponse(res, 400, { error: body.error });
    return;
  }
  if (!installed.has(body.runtime)) {
    jsonResponse(res, 400, {
      error: `${body.runtime} is not installed on this device`,
    });
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  let exitCode = 0;
  try {
    for await (const chunk of runOnce({
      kind: body.runtime,
      prompt: body.prompt,
      spawnEnv,
      signal: controller.signal,
    })) {
      sseEvent(res, { type: chunk.stream, data: chunk.data });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sseEvent(res, { type: "stderr", data: message });
    exitCode = 1;
  }
  sseEvent(res, { type: "done", code: exitCode });
  res.end();
}
