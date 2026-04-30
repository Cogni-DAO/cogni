// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker/tests/review-activities.test`
 * Purpose: Unit tests for fetchPrContextActivity owning-node routing + per-node rule path.
 * Scope: Activity behavior with a fake Octokit. No real GitHub I/O.
 * Invariants:
 *   - PER_NODE_RULE_LOADING: non-operator singles fetch from <path>/.cogni/rules/
 *   - operator singles use root .cogni/rules/
 *   - review.routed log emitted with owningNode shape
 *   - postRoutingDiagnosticActivity posts neutral check + diagnostic comment
 * Side-effects: none
 * Links: task.0410
 * @internal
 */

import { TEST_NODE_ENTRIES, TEST_NODE_IDS } from "@cogni/repo-spec/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";

// Shared request log + handler map mutated per-test before invoking the activity.
const requests: Array<{ route: string; params: unknown }> = [];
let routeHandlers: Record<string, (params: unknown) => unknown> = {};

vi.mock("@octokit/auth-app", () => ({
  createAppAuth: () => () => ({ token: "fake" }),
}));

vi.mock("@octokit/core", () => ({
  Octokit: class {
    request = async (route: string, params: unknown) => {
      requests.push({ route, params });
      const handler = routeHandlers[route];
      if (!handler) {
        throw new Error(`Unhandled route in test: ${route}`);
      }
      return { data: handler(params) };
    };
  },
}));

import { createReviewActivities } from "../src/activities/review.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => mockLogger,
} as unknown as Parameters<typeof createReviewActivities>[0]["logger"];

const minimalRepoSpecYaml = stringifyYaml({
  node_id: TEST_NODE_IDS.operator,
  scope_id: "00000000-0000-4000-8000-000000000002",
  cogni_dao: { chain_id: "8453" },
  payments_in: {
    credits_topup: {
      provider: "cogni-usdc-backend-v1",
      receiving_address: "0x1111111111111111111111111111111111111111",
    },
  },
  nodes: [
    TEST_NODE_ENTRIES.operator,
    TEST_NODE_ENTRIES.poly,
    TEST_NODE_ENTRIES.resy,
  ],
  gates: [
    {
      type: "ai-rule",
      with: { rule_file: "quality.rule.yaml" },
    },
  ],
});

const ruleYaml = stringifyYaml({
  id: "quality",
  evaluations: [{ quality: "Is it good?" }],
  success_criteria: { require: [{ metric: "quality", gte: 0.8 }] },
});

interface FetchPrFakes {
  changedFiles: string[];
  ruleAvailableAt?: string;
}

function setFetchPrHandlers(fakes: FetchPrFakes): void {
  routeHandlers = {
    "GET /repos/{owner}/{repo}/pulls/{pull_number}": () => ({
      number: 123,
      title: "test pr",
      body: "",
      head: { sha: "deadbeef" },
      base: { ref: "main" },
      changed_files: fakes.changedFiles.length,
      additions: 1,
      deletions: 0,
    }),
    "GET /repos/{owner}/{repo}/pulls/{pull_number}/files": () =>
      fakes.changedFiles.map((f) => ({ filename: f, patch: "+x" })),
    "GET /repos/{owner}/{repo}/contents/{path}": (params: unknown) => {
      const { path } = params as { path: string };
      if (path === ".cogni/repo-spec.yaml") return minimalRepoSpecYaml;
      if (fakes.ruleAvailableAt && path === fakes.ruleAvailableAt)
        return ruleYaml;
      const err = new Error(`Not Found: ${path}`) as Error & {
        status?: number;
      };
      err.status = 404;
      throw err;
    },
  };
}

function makeActivities() {
  return createReviewActivities({
    ghAppId: "1",
    ghPrivateKey: "key",
    logger: mockLogger,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  routeHandlers = {};
});

describe("fetchPrContextActivity — owning-node routing", () => {
  it("returns owningNode=single + fetches rules from per-node path for poly PR", async () => {
    setFetchPrHandlers({
      changedFiles: ["nodes/poly/app/src/foo.ts"],
      ruleAvailableAt: "nodes/poly/.cogni/rules/quality.rule.yaml",
    });
    const acts = makeActivities();

    const result = await acts.fetchPrContextActivity({
      owner: "org",
      repo: "repo",
      prNumber: 123,
      installationId: 1,
    });

    expect(result.owningNode.kind).toBe("single");
    if (result.owningNode.kind === "single") {
      expect(result.owningNode.path).toBe("nodes/poly");
    }
    expect(result.changedFiles).toEqual(["nodes/poly/app/src/foo.ts"]);

    const ruleFetches = requests.filter(
      (r) =>
        r.route === "GET /repos/{owner}/{repo}/contents/{path}" &&
        (r.params as { path: string }).path.endsWith("quality.rule.yaml")
    );
    expect(ruleFetches.length).toBe(1);
    expect((ruleFetches[0]?.params as { path: string }).path).toBe(
      "nodes/poly/.cogni/rules/quality.rule.yaml"
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        owningNodeKind: "single",
        owningNodePath: "nodes/poly",
        changedFileCount: 1,
        prNumber: 123,
      }),
      "review.routed"
    );
  });

  it("operator-only PR fetches rules from nodes/operator/.cogni/rules/ (no special case)", async () => {
    setFetchPrHandlers({
      changedFiles: ["packages/repo-spec/src/x.ts"],
      ruleAvailableAt: "nodes/operator/.cogni/rules/quality.rule.yaml",
    });
    const acts = makeActivities();

    const result = await acts.fetchPrContextActivity({
      owner: "org",
      repo: "repo",
      prNumber: 123,
      installationId: 1,
    });

    expect(result.owningNode.kind).toBe("single");
    if (result.owningNode.kind === "single") {
      expect(result.owningNode.path).toBe("nodes/operator");
    }

    const ruleFetches = requests.filter(
      (r) =>
        r.route === "GET /repos/{owner}/{repo}/contents/{path}" &&
        (r.params as { path: string }).path.endsWith("quality.rule.yaml")
    );
    expect(ruleFetches.length).toBe(1);
    expect((ruleFetches[0]?.params as { path: string }).path).toBe(
      "nodes/operator/.cogni/rules/quality.rule.yaml"
    );
  });

  it("cross-domain PR returns owningNode=conflict", async () => {
    setFetchPrHandlers({
      changedFiles: ["nodes/poly/x.ts", "nodes/resy/y.ts"],
    });
    const acts = makeActivities();

    const result = await acts.fetchPrContextActivity({
      owner: "org",
      repo: "repo",
      prNumber: 123,
      installationId: 1,
    });

    expect(result.owningNode.kind).toBe("conflict");
    if (result.owningNode.kind === "conflict") {
      expect(result.owningNode.nodes.map((n) => n.nodeId)).toEqual(
        expect.arrayContaining([TEST_NODE_IDS.poly, TEST_NODE_IDS.resy])
      );
    }
  });

  it("ride-along (poly + pnpm-lock.yaml) routes to single poly", async () => {
    setFetchPrHandlers({
      changedFiles: ["nodes/poly/x.ts", "pnpm-lock.yaml"],
      ruleAvailableAt: "nodes/poly/.cogni/rules/quality.rule.yaml",
    });
    const acts = makeActivities();

    const result = await acts.fetchPrContextActivity({
      owner: "org",
      repo: "repo",
      prNumber: 123,
      installationId: 1,
    });

    expect(result.owningNode.kind).toBe("single");
    if (result.owningNode.kind === "single") {
      expect(result.owningNode.nodeId).toBe(TEST_NODE_IDS.poly);
      expect(result.owningNode.rideAlongApplied).toBe(true);
    }
  });
});

describe("postRoutingDiagnosticActivity", () => {
  it("posts a comment + neutral check-run for conflict", async () => {
    routeHandlers = {
      "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}": () => ({}),
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments": () => ({}),
    };
    const acts = makeActivities();

    await acts.postRoutingDiagnosticActivity({
      owner: "org",
      repo: "repo",
      prNumber: 7,
      headSha: "deadbeef",
      installationId: 1,
      checkRunId: 99,
      owningNode: {
        kind: "conflict",
        nodes: [
          { nodeId: "poly", path: "nodes/poly" },
          { nodeId: "resy", path: "nodes/resy" },
        ],
        operatorPaths: [],
      },
      changedFiles: ["nodes/poly/a.ts", "nodes/resy/b.ts"],
    });

    const patch = requests.find(
      (r) => r.route === "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}"
    );
    expect(patch).toBeDefined();
    expect((patch?.params as { conclusion: string }).conclusion).toBe(
      "neutral"
    );

    const comment = requests.find(
      (r) =>
        r.route === "POST /repos/{owner}/{repo}/issues/{issue_number}/comments"
    );
    expect(comment).toBeDefined();
    expect((comment?.params as { body: string }).body).toContain(
      "Cross-Domain PR refused"
    );
  });

  it("posts neutral 'no recognizable scope' for miss", async () => {
    routeHandlers = {
      "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}": () => ({}),
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments": () => ({}),
    };
    const acts = makeActivities();

    await acts.postRoutingDiagnosticActivity({
      owner: "org",
      repo: "repo",
      prNumber: 8,
      headSha: "deadbeef",
      installationId: 1,
      checkRunId: 100,
      owningNode: { kind: "miss" },
      changedFiles: [],
    });

    const comment = requests.find(
      (r) =>
        r.route === "POST /repos/{owner}/{repo}/issues/{issue_number}/comments"
    );
    expect((comment?.params as { body: string }).body).toContain(
      "No recognizable scope"
    );
  });
});
