// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cli/tests/runtime`
 * Purpose: Unit tests for the runtime detector and tunnel URL parser. Exercises pure logic only.
 * Scope: Pure-logic only; does not spawn subprocesses (the detector receives an injected exec function).
 * Invariants: Tests must run in <1s and never touch the network.
 * Side-effects: none
 * Links: src/dev/runtime.ts, src/dev/tunnel.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import { detectRuntimes } from "../src/dev/runtime.js";
import { parseTunnelUrl } from "../src/dev/tunnel.js";

describe("detectRuntimes", () => {
  it("marks both runtimes installed when the probe succeeds", async () => {
    const out = await detectRuntimes({
      exec: async (cmd) => {
        if (cmd === "claude")
          return { stdout: "2.1.128 (Claude Code)\n", code: 0 };
        if (cmd === "codex") return { stdout: "codex-cli 0.116.0\n", code: 0 };
        return { stdout: "", code: 127 };
      },
    });
    expect(out).toEqual([
      {
        kind: "claude",
        command: "claude",
        installed: true,
        version: "2.1.128 (Claude Code)",
      },
      {
        kind: "codex",
        command: "codex",
        installed: true,
        version: "codex-cli 0.116.0",
      },
    ]);
  });

  it("marks runtimes uninstalled when the probe fails", async () => {
    const out = await detectRuntimes({
      exec: async () => ({ stdout: "", code: 127 }),
    });
    expect(out.every((r) => !r.installed)).toBe(true);
  });

  it("marks runtimes uninstalled when the probe exits non-zero", async () => {
    const out = await detectRuntimes({
      exec: async () => ({ stdout: "claude not found", code: 1 }),
    });
    expect(out.every((r) => !r.installed)).toBe(true);
  });
});

describe("parseTunnelUrl", () => {
  it("extracts a trycloudflare URL from a noisy line", () => {
    const line =
      "2026-05-05T22:11:03Z INF |  https://accurately-hydrogen-adware-batman.trycloudflare.com  |";
    expect(parseTunnelUrl(line)).toBe(
      "https://accurately-hydrogen-adware-batman.trycloudflare.com"
    );
  });

  it("returns null for unrelated lines", () => {
    expect(parseTunnelUrl("Starting tunnel… please wait")).toBeNull();
  });

  it("only matches https URLs", () => {
    expect(parseTunnelUrl("http://oops.trycloudflare.com")).toBeNull();
  });
});
