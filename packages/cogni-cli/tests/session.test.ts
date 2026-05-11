// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cli/tests/session`
 * Purpose: Verify the session-dir provisioning + teardown contract of `provisionSession`. The module deliberately does no env / HOME manipulation, so the test surface is intentionally small.
 * Scope: Filesystem assertions only. Does not spawn agents and does not bind a network listener.
 * Invariants:
 *   - INV-DIR-CREATED: provisionSession creates the session dir at the expected path.
 *   - INV-TEARDOWN-CLEANS: teardown removes the session dir.
 * Side-effects: IO (creates a fresh tmp dir for each test)
 * Links: src/dev/session.ts, docs/spec/byo-agent-runtime-bridge.md
 * @internal
 */

import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { provisionSession } from "../src/dev/session.js";

let baseDir: string;

beforeEach(async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "cogni-cli-session-"));
  baseDir = join(tmpRoot, "base");
});

describe("provisionSession", () => {
  it("creates the session dir under baseDir/sessions/<id>", async () => {
    const session = await provisionSession({
      baseDir,
      sessionId: "test-session-1",
    });

    try {
      const expected = join(baseDir, "sessions", "test-session-1");
      expect(session.sessionDir).toBe(expected);
      expect(session.sessionId).toBe("test-session-1");
      const st = await stat(expected);
      expect(st.isDirectory()).toBe(true);
    } finally {
      await session.teardown();
    }
  });

  it("teardown removes the session dir", async () => {
    const session = await provisionSession({
      baseDir,
      sessionId: "test-session-2",
    });
    await session.teardown();
    await expect(stat(session.sessionDir)).rejects.toThrow();
  });

  it("teardown is idempotent — second call does not throw", async () => {
    const session = await provisionSession({
      baseDir,
      sessionId: "test-session-3",
    });
    await session.teardown();
    await expect(session.teardown()).resolves.toBeUndefined();
  });
});
