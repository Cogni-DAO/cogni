// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cli/dev/runtime`
 * Purpose: Detect installed agent runtimes (`claude`, `codex`) and spawn them in batch (`--print` / `exec`) mode.
 * Scope: Subprocess management only. Does not bind HTTP and does not manage tunneling — siblings do that.
 * Invariants:
 *   - Detection is best-effort: a missing binary => `installed=false` (never throws).
 *   - Spawn returns the merged stdout/stderr stream chunks via an AsyncIterable to keep memory bounded.
 *   - The CLI never reads or forwards Anthropic/OpenAI credentials; the spawned binary uses whatever local auth the user already has.
 * Side-effects: IO (spawns child processes)
 * Links: docs/research/byo-agent-runtime-bridge.md
 * @public
 */

import { spawn } from "node:child_process";

import type { SpawnEnv } from "./session.js";

export type RuntimeKind = "claude" | "codex";

export interface Runtime {
  kind: RuntimeKind;
  command: string;
  installed: boolean;
  version?: string;
}

interface DetectOptions {
  /** Override PATH lookup (test seam). */
  exec?: (
    cmd: string,
    args: string[]
  ) => Promise<{ stdout: string; code: number }>;
}

async function defaultExec(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.on("error", () => resolve({ stdout: "", code: 127 }));
    child.on("close", (code) => resolve({ stdout, code: code ?? 0 }));
  });
}

export async function detectRuntimes(
  opts: DetectOptions = {}
): Promise<Runtime[]> {
  const exec = opts.exec ?? defaultExec;
  const probes: Array<{ kind: RuntimeKind; command: string; args: string[] }> =
    [
      { kind: "claude", command: "claude", args: ["--version"] },
      { kind: "codex", command: "codex", args: ["--version"] },
    ];
  const results: Runtime[] = [];
  for (const probe of probes) {
    const { stdout, code } = await exec(probe.command, probe.args);
    if (code === 0 && stdout.trim().length > 0) {
      results.push({
        kind: probe.kind,
        command: probe.command,
        installed: true,
        version: stdout.trim().split("\n")[0],
      });
    } else {
      results.push({
        kind: probe.kind,
        command: probe.command,
        installed: false,
      });
    }
  }
  return results;
}

export interface RunInvocation {
  kind: RuntimeKind;
  prompt: string;
  /** Sanitized cwd + env handed to the spawned agent (see `session.provisionSession`). */
  spawnEnv: SpawnEnv;
  signal: AbortSignal;
}

export interface RunChunk {
  stream: "stdout" | "stderr";
  data: string;
}

export interface RunResult {
  exitCode: number;
}

/**
 * Spawn the requested runtime in batch mode and yield stdout/stderr chunks as they arrive.
 * Caller is responsible for surfacing chunks (e.g. as Server-Sent Events).
 */
export async function* runOnce(
  invocation: RunInvocation
): AsyncIterable<RunChunk> {
  const { kind, prompt, spawnEnv, signal } = invocation;
  const args = kind === "claude" ? ["--print", prompt] : ["exec", prompt];
  const child = spawn(kind, args, {
    cwd: spawnEnv.cwd,
    env: spawnEnv.env,
    stdio: ["ignore", "pipe", "pipe"],
    signal,
  });

  type Item = RunChunk | { done: true; code: number } | { error: Error };
  const queue: Item[] = [];
  let waiter: ((value: Item) => void) | null = null;

  const push = (item: Item): void => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(item);
    } else {
      queue.push(item);
    }
  };

  child.stdout.on("data", (d: Buffer) =>
    push({ stream: "stdout", data: d.toString("utf8") })
  );
  child.stderr.on("data", (d: Buffer) =>
    push({ stream: "stderr", data: d.toString("utf8") })
  );
  child.on("error", (err) => push({ error: err }));
  child.on("close", (code) => push({ done: true, code: code ?? 0 }));

  while (true) {
    const next = await new Promise<Item>((resolve) => {
      const item = queue.shift();
      if (item) resolve(item);
      else waiter = resolve;
    });
    if ("error" in next) throw next.error;
    if ("done" in next) return;
    yield next;
  }
}
