// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cli/tests/session`
 * Purpose: Verify the soft-isolation contract of `provisionSession`: HOME override, env allowlist, auth-dir symlink surfacing, and teardown.
 * Scope: Filesystem + env-var assertions. Spawns one short-lived `node -e` process to prove the env reaches the child; does not spawn `claude` / `codex` and does not bind a network listener.
 * Invariants:
 *   - INV-NO-SECRET-LEAK: a parent env containing an Anthropic / OpenAI / Cogni API key must NOT survive into the spawned child's env.
 *   - INV-HOME-OVERRIDE: the spawned child sees HOME = sessionDir (not the user's real home).
 * Side-effects: IO (creates a fresh tmp dir for each test, spawns node)
 * Links: src/dev/session.ts, docs/spec/byo-agent-runtime-bridge.md
 * @internal
 */

import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { provisionSession } from "../src/dev/session.js";

let tmpRoot: string;
let fakeHome: string;
let baseDir: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "cogni-cli-session-"));
  fakeHome = join(tmpRoot, "home");
  baseDir = join(tmpRoot, "base");
  await mkdir(fakeHome, { recursive: true });
});

afterEach(async () => {
  // sessions are torn down inside their tests; tmpRoot is left for inspection on
  // failure and reaped by the OS — this is fine for vitest's tmpdir.
});

const PARENT_ENV_WITH_SECRETS: NodeJS.ProcessEnv = {
  // node's child_process spawn needs PATH on the env to find `node` itself
  // when the env is fully replaced. Hardcoded so the test is hermetic.
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/imaginary-real-home",
  USER: "imaginary-user",
  ANTHROPIC_API_KEY: "sk-ant-leaked-please-no",
  OPENAI_API_KEY: "sk-leaked-please-no",
  COGNI_API_KEY_PROD: "cogni_ag_sk_v1_leaked",
  AWS_SECRET_ACCESS_KEY: "leaked-aws",
  GITHUB_TOKEN: "ghp_leaked",
};

describe("provisionSession", () => {
  it("creates a session dir, overrides HOME, and prunes secrets from the spawn env", async () => {
    const session = await provisionSession({
      baseDir,
      realHome: fakeHome,
      parentEnv: PARENT_ENV_WITH_SECRETS,
      sessionId: "test-session-1",
    });

    try {
      const expectedDir = join(baseDir, "sessions", "test-session-1");
      expect(session.sessionDir).toBe(expectedDir);
      expect(session.spawnEnv.cwd).toBe(expectedDir);
      const st = await stat(expectedDir);
      expect(st.isDirectory()).toBe(true);

      // HOME must be overridden to the session dir.
      expect(session.spawnEnv.env.HOME).toBe(expectedDir);

      // Allowlisted keys survive.
      expect(session.spawnEnv.env.PATH).toBe(PARENT_ENV_WITH_SECRETS.PATH);
      expect(session.spawnEnv.env.USER).toBe("imaginary-user");

      // Sensitive keys are dropped.
      for (const dropped of [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "COGNI_API_KEY_PROD",
        "AWS_SECRET_ACCESS_KEY",
        "GITHUB_TOKEN",
      ]) {
        expect(session.spawnEnv.env[dropped]).toBeUndefined();
      }
    } finally {
      await session.teardown();
    }
  });

  it("symlinks ~/.claude and ~/.codex into the session dir when they exist", async () => {
    const realClaude = join(fakeHome, ".claude");
    const realCodex = join(fakeHome, ".codex");
    await mkdir(realClaude, { recursive: true });
    await mkdir(realCodex, { recursive: true });
    await writeFile(join(realClaude, "config.json"), '{"x":1}');

    const session = await provisionSession({
      baseDir,
      realHome: fakeHome,
      parentEnv: PARENT_ENV_WITH_SECRETS,
      sessionId: "test-session-2",
    });

    try {
      const linkClaude = join(session.sessionDir, ".claude");
      const linkCodex = join(session.sessionDir, ".codex");
      expect(await readlink(linkClaude)).toBe(realClaude);
      expect(await readlink(linkCodex)).toBe(realCodex);
    } finally {
      await session.teardown();
    }
  });

  it("skips symlinks silently when the auth dirs are absent", async () => {
    // fakeHome is empty — no .claude, no .codex.
    const session = await provisionSession({
      baseDir,
      realHome: fakeHome,
      parentEnv: PARENT_ENV_WITH_SECRETS,
      sessionId: "test-session-3",
    });

    try {
      await expect(
        readlink(join(session.sessionDir, ".claude"))
      ).rejects.toThrow();
      await expect(
        readlink(join(session.sessionDir, ".codex"))
      ).rejects.toThrow();
    } finally {
      await session.teardown();
    }
  });

  it("teardown removes the session dir", async () => {
    const session = await provisionSession({
      baseDir,
      realHome: fakeHome,
      parentEnv: PARENT_ENV_WITH_SECRETS,
      sessionId: "test-session-4",
    });

    await session.teardown();
    await expect(stat(session.sessionDir)).rejects.toThrow();
  });

  it("the env actually reaches a spawned child (HOME override + no secret leak)", async () => {
    const session = await provisionSession({
      baseDir,
      realHome: fakeHome,
      parentEnv: PARENT_ENV_WITH_SECRETS,
      sessionId: "test-session-5",
    });

    try {
      const childOutput = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "-e",
            `process.stdout.write(JSON.stringify({
              home: process.env.HOME,
              cwd: process.cwd(),
              hasAnthropic: process.env.ANTHROPIC_API_KEY !== undefined,
              hasCogni: process.env.COGNI_API_KEY_PROD !== undefined,
              hasOpenAI: process.env.OPENAI_API_KEY !== undefined,
            }))`,
          ],
          {
            cwd: session.spawnEnv.cwd,
            env: session.spawnEnv.env,
            stdio: ["ignore", "pipe", "pipe"],
          }
        );
        let out = "";
        child.stdout.on("data", (d: Buffer) => {
          out += d.toString("utf8");
        });
        child.on("error", reject);
        child.on("close", () => resolve(out));
      });

      const parsed = JSON.parse(childOutput) as {
        home: string;
        cwd: string;
        hasAnthropic: boolean;
        hasCogni: boolean;
        hasOpenAI: boolean;
      };
      // process.cwd() resolves symlinks (macOS /var → /private/var); compare
      // against the realpath, not the constructed session path.
      const sessionRealpath = await realpath(session.sessionDir);
      expect(parsed.home).toBe(session.sessionDir);
      expect(parsed.cwd).toBe(sessionRealpath);
      expect(parsed.hasAnthropic).toBe(false);
      expect(parsed.hasCogni).toBe(false);
      expect(parsed.hasOpenAI).toBe(false);
    } finally {
      await session.teardown();
    }
  });
});
