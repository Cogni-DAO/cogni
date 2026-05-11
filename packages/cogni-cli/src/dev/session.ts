// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cli/dev/session`
 * Purpose: Provision a per-process workspace dir under `~/.cogni/sessions/<id>/` for `cogni dev` to run agents in, and tear it down on shutdown. Nothing more.
 * Scope: Filesystem only. Does not modify the spawn env, does not constrain `HOME`, does not pretend to sandbox the spawned agent. Real isolation is a future Phase 4 container item; this module deliberately does not approximate it.
 * Invariants:
 *   - The session dir is created with mode 0700 under `~/.cogni/sessions/`.
 *   - Teardown is best-effort: a missing or partially-cleaned session dir does not throw.
 *   - Spawned agents inherit the user's real env and HOME. Auth, toolchain managers (Volta / nvm / pnpm), keychain, and shell config Just Work because nothing has been stripped.
 * Side-effects: IO (creates a directory under `~/.cogni/sessions/`)
 * Links: docs/spec/byo-agent-runtime-bridge.md (Phase 1 — Session Workspace)
 * @public
 */

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SessionHandle {
  sessionId: string;
  sessionDir: string;
  teardown: () => Promise<void>;
}

export interface ProvisionOptions {
  /** Override the `.cogni` base dir (test seam). Defaults to `${homedir()}/.cogni`. */
  baseDir?: string;
  /** Override the session id generator (test seam). */
  sessionId?: string;
}

export async function provisionSession(
  opts: ProvisionOptions = {}
): Promise<SessionHandle> {
  const baseDir = opts.baseDir ?? join(homedir(), ".cogni");
  const sessionId = opts.sessionId ?? randomUUID();
  const sessionDir = join(baseDir, "sessions", sessionId);

  await mkdir(sessionDir, { recursive: true, mode: 0o700 });

  return {
    sessionId,
    sessionDir,
    teardown: async () => {
      await rm(sessionDir, { recursive: true, force: true });
    },
  };
}
