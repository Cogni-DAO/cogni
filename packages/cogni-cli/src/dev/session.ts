// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cli/dev/session`
 * Purpose: Provision a per-process workspace for `cogni dev` and return the spawn environment (`cwd` + sanitized `env`) the agent runtimes are launched under. Provides soft isolation by overriding `HOME` and pruning the parent process env to a minimal allowlist.
 * Scope: Filesystem + env-var hygiene. Does not spawn agents and does not bind the local HTTP server — that is sibling work.
 * Invariants:
 *   - Spawned agents see `HOME = sessionDir`, never the real user home.
 *   - The env handed to spawned agents contains only keys on `ENV_ALLOWLIST`, plus the overridden `HOME`. No `ANTHROPIC_*`, `OPENAI_*`, `COGNI_*` etc. leaks through.
 *   - `~/.claude` and `~/.codex` from the real home are surfaced into the session dir via symlinks **only** when present, so existing local auth keeps working without exposing the rest of the real home.
 *   - Teardown is best-effort: a missing or partially-cleaned session dir does not throw.
 * Side-effects: IO (creates directories + symlinks under `~/.cogni/sessions/`)
 * Links: docs/spec/byo-agent-runtime-bridge.md (Phase 1 — Isolation)
 * @public
 */

import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SpawnEnv {
  /** Working directory the agent is spawned in. */
  cwd: string;
  /** Sanitized environment passed to the spawn (full replacement of parent env). */
  env: NodeJS.ProcessEnv;
}

export interface SessionHandle {
  sessionId: string;
  sessionDir: string;
  spawnEnv: SpawnEnv;
  teardown: () => Promise<void>;
}

export interface ProvisionOptions {
  /** Override the `.cogni` base dir (test seam). Defaults to `${homedir()}/.cogni`. */
  baseDir?: string;
  /** Override the real home used to surface `.claude` / `.codex` (test seam). */
  realHome?: string;
  /** Override the parent env to copy allowlisted keys from (test seam). */
  parentEnv?: NodeJS.ProcessEnv;
  /** Override the session id generator (test seam). */
  sessionId?: string;
}

/**
 * Env keys that survive the prune. Anything not on this list (or matching the logic-prefix
 * cases below) is dropped before spawning the agent.
 */
const ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TMPDIR",
  // Node-managed internals the spawned process may need to find native modules.
  "NODE_PATH",
];

/** Auth dirs we surface into the session dir if they exist on the real home. */
const AUTH_DIRS: readonly string[] = [".claude", ".codex"];

function sanitizeEnv(
  parentEnv: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const v = parentEnv[key];
    if (v !== undefined) out[key] = v;
  }
  return { ...out, ...overrides };
}

async function trySymlink(target: string, linkPath: string): Promise<void> {
  try {
    const st = await stat(target);
    if (!st.isDirectory()) return;
    await symlink(target, linkPath, "dir");
  } catch {
    // Target missing or unreadable — skip silently. Agent will see an empty home.
  }
}

export async function provisionSession(
  opts: ProvisionOptions = {}
): Promise<SessionHandle> {
  const baseDir = opts.baseDir ?? join(homedir(), ".cogni");
  const realHome = opts.realHome ?? homedir();
  // biome-ignore lint/style/noProcessEnv: leaf CLI; no config framework. The point of this module is to read parent env once and prune it.
  const parentEnv = opts.parentEnv ?? process.env;
  const sessionId = opts.sessionId ?? randomUUID();
  const sessionDir = join(baseDir, "sessions", sessionId);

  await mkdir(sessionDir, { recursive: true, mode: 0o700 });

  for (const name of AUTH_DIRS) {
    await trySymlink(join(realHome, name), join(sessionDir, name));
  }

  const env = sanitizeEnv(parentEnv, {
    HOME: sessionDir,
  });

  return {
    sessionId,
    sessionDir,
    spawnEnv: { cwd: sessionDir, env },
    teardown: async () => {
      await rm(sessionDir, { recursive: true, force: true });
    },
  };
}
