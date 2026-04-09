// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tests/vcs-flight-candidate`
 * Purpose: Unit tests for the vcs-flight-candidate tool.
 * Scope: Contract shape, implementation delegation, stub behavior, catalog registration. Does not invoke GitHub API or real I/O.
 * Invariants: TOOL_ID_NAMESPACED, EFFECT_TYPED, NO_AUTO_FLIGHT
 * Side-effects: none
 * Links: src/tools/vcs-flight-candidate.ts, task.0297
 * @internal
 */

import { describe, expect, it, vi } from "vitest";

import { hasToolId } from "../src/catalog";
import type { VcsCapability } from "../src/capabilities/vcs";
import {
  createVcsFlightCandidateImplementation,
  VCS_FLIGHT_CANDIDATE_NAME,
  VcsFlightCandidateInputSchema,
  VcsFlightCandidateOutputSchema,
  vcsFlightCandidateBoundTool,
  vcsFlightCandidateContract,
  vcsFlightCandidateStubImplementation,
} from "../src/tools/vcs-flight-candidate";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeCapability(
  overrides: Partial<VcsCapability> = {}
): VcsCapability {
  return {
    listPrs: vi.fn(),
    getCiStatus: vi.fn(),
    mergePr: vi.fn(),
    createBranch: vi.fn(),
    flightCandidate: vi.fn(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract shape
// ─────────────────────────────────────────────────────────────────────────────

describe("vcsFlightCandidateContract", () => {
  it("has correct tool ID (TOOL_ID_NAMESPACED)", () => {
    expect(vcsFlightCandidateContract.name).toBe("core__vcs_flight_candidate");
    expect(VCS_FLIGHT_CANDIDATE_NAME).toBe("core__vcs_flight_candidate");
  });

  it("has effect: state_change (EFFECT_TYPED)", () => {
    expect(vcsFlightCandidateContract.effect).toBe("state_change");
  });

  it("allowlist covers all output fields", () => {
    expect(vcsFlightCandidateContract.allowlist).toEqual(
      expect.arrayContaining([
        "dispatched",
        "sha",
        "prNumber",
        "workflowUrl",
        "message",
      ])
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input schema
// ─────────────────────────────────────────────────────────────────────────────

describe("VcsFlightCandidateInputSchema", () => {
  it("accepts valid input with sha only", () => {
    const result = VcsFlightCandidateInputSchema.safeParse({
      owner: "Cogni-DAO",
      repo: "node-template",
      sha: "abc1234def5",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with sha + prNumber", () => {
    const result = VcsFlightCandidateInputSchema.safeParse({
      owner: "Cogni-DAO",
      repo: "node-template",
      sha: "abc1234def5",
      prNumber: 851,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prNumber).toBe(851);
    }
  });

  it("rejects sha shorter than 7 chars", () => {
    const result = VcsFlightCandidateInputSchema.safeParse({
      owner: "Cogni-DAO",
      repo: "node-template",
      sha: "abc12",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty owner", () => {
    const result = VcsFlightCandidateInputSchema.safeParse({
      owner: "",
      repo: "node-template",
      sha: "abc1234def5",
    });
    expect(result.success).toBe(false);
  });

  it("prNumber is optional", () => {
    const result = VcsFlightCandidateInputSchema.safeParse({
      owner: "Cogni-DAO",
      repo: "node-template",
      sha: "abc1234def5",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prNumber).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output schema
// ─────────────────────────────────────────────────────────────────────────────

describe("VcsFlightCandidateOutputSchema", () => {
  it("validates a well-formed output", () => {
    const result = VcsFlightCandidateOutputSchema.safeParse({
      dispatched: true,
      sha: "abc1234def5",
      prNumber: 851,
      workflowUrl:
        "https://github.com/Cogni-DAO/node-template/actions/workflows/candidate-flight.yml",
      message: "Flight dispatched for PR #851 @ abc1234",
    });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Implementation — delegates to capability
// ─────────────────────────────────────────────────────────────────────────────

describe("createVcsFlightCandidateImplementation", () => {
  it("delegates to vcsCapability.flightCandidate with all fields", async () => {
    const fakeResult = {
      dispatched: true,
      sha: "abc1234def5",
      prNumber: 851,
      workflowUrl:
        "https://github.com/Cogni-DAO/node-template/actions/workflows/candidate-flight.yml",
      message: "Flight dispatched for PR #851 @ abc1234",
    };
    const cap = makeCapability({
      flightCandidate: vi.fn().mockResolvedValue(fakeResult),
    });
    const impl = createVcsFlightCandidateImplementation({
      vcsCapability: cap,
    });

    const result = await impl.execute({
      owner: "Cogni-DAO",
      repo: "node-template",
      sha: "abc1234def5",
      prNumber: 851,
    });

    expect(cap.flightCandidate).toHaveBeenCalledWith({
      owner: "Cogni-DAO",
      repo: "node-template",
      sha: "abc1234def5",
      prNumber: 851,
    });
    expect(result).toEqual(fakeResult);
  });

  it("passes undefined prNumber when not supplied (SHA-only dispatch)", async () => {
    const fakeResult = {
      dispatched: true,
      sha: "abc1234def5",
      prNumber: 900,
      workflowUrl: "https://github.com/Cogni-DAO/node-template/actions/workflows/candidate-flight.yml",
      message: "Flight dispatched for PR #900 @ abc1234",
    };
    const cap = makeCapability({
      flightCandidate: vi.fn().mockResolvedValue(fakeResult),
    });
    const impl = createVcsFlightCandidateImplementation({
      vcsCapability: cap,
    });

    await impl.execute({
      owner: "Cogni-DAO",
      repo: "node-template",
      sha: "abc1234def5",
    });

    expect(cap.flightCandidate).toHaveBeenCalledWith({
      owner: "Cogni-DAO",
      repo: "node-template",
      sha: "abc1234def5",
      prNumber: undefined,
    });
  });

  it("propagates capability errors", async () => {
    const cap = makeCapability({
      flightCandidate: vi
        .fn()
        .mockRejectedValue(new Error("No open PR found for SHA")),
    });
    const impl = createVcsFlightCandidateImplementation({
      vcsCapability: cap,
    });

    await expect(
      impl.execute({
        owner: "Cogni-DAO",
        repo: "node-template",
        sha: "abc1234def5",
      })
    ).rejects.toThrow("No open PR found for SHA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stub — throws on use
// ─────────────────────────────────────────────────────────────────────────────

describe("vcsFlightCandidateStubImplementation", () => {
  it("throws when called (GRACEFUL_DEGRADATION)", async () => {
    await expect(
      vcsFlightCandidateStubImplementation.execute({
        owner: "Cogni-DAO",
        repo: "node-template",
        sha: "abc1234def5",
      })
    ).rejects.toThrow("VcsCapability not configured.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bound tool
// ─────────────────────────────────────────────────────────────────────────────

describe("vcsFlightCandidateBoundTool", () => {
  it("bound tool has contract and stub implementation", () => {
    expect(vcsFlightCandidateBoundTool.contract).toBe(vcsFlightCandidateContract);
    expect(vcsFlightCandidateBoundTool.implementation).toBe(
      vcsFlightCandidateStubImplementation
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Catalog registration
// ─────────────────────────────────────────────────────────────────────────────

describe("TOOL_CATALOG registration", () => {
  it("core__vcs_flight_candidate is registered in TOOL_CATALOG", () => {
    expect(hasToolId("core__vcs_flight_candidate")).toBe(true);
  });
});
