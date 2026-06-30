// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/internal/webhooks/[source]/route` (resolveTargetNode unit)
 * Purpose: Pin the multi-node ingestion-routing decision (story.5023, PR A): a github webhook for a
 *   registered repo routes to THAT node; an unregistered repo (or non-github source) falls back to the
 *   operator node. Mocks the DB/container leaves; exercises the real resolution branch.
 * Scope: Pure resolution logic — no HTTP, no real DB.
 * Side-effects: none
 * Links: src/features/nodes/node-lookup.ts, src/adapters/server/ingestion/github-webhook.ts
 * @public
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const OPERATOR_NODE_ID = "operator-node-id";

const mockFindNodeByRepo = vi.hoisted(() => vi.fn());

// Container/config/facade leaves the route module pulls at import time — stub to no-ops so importing
// the route is side-effect-free and resolveTargetNode can be exercised in isolation.
vi.mock("@/bootstrap/container", () => ({
  getContainer: () => ({}),
  resolveServiceDb: () => ({}),
}));
vi.mock("@/shared/config", () => ({
  getNodeId: () => OPERATOR_NODE_ID,
}));
vi.mock("@/features/nodes/node-lookup", () => ({
  findNodeByRepo: (...args: unknown[]) => mockFindNodeByRepo(...args),
}));
vi.mock("@/app/_facades/deploy/canonical-fork-sync.server", () => ({
  dispatchCanonicalForkSync: vi.fn(),
}));
vi.mock("@/app/_facades/deploy/node-preview-promote.server", () => ({
  dispatchNodePreviewPromote: vi.fn(),
}));
vi.mock("@/app/_facades/review/dispatch.server", () => ({
  dispatchPrReview: vi.fn(),
}));
vi.mock("@/features/governance/services/signal-dispatch", () => ({
  dispatchSignalExecution: vi.fn(),
}));

import { resolveTargetNode } from "./route";

function githubBody(fullName: string | undefined): Buffer {
  const repository =
    fullName === undefined ? undefined : { full_name: fullName };
  return Buffer.from(JSON.stringify({ repository }), "utf-8");
}

describe("resolveTargetNode", () => {
  beforeEach(() => {
    mockFindNodeByRepo.mockReset();
  });

  it("routes a registered repo to its owning node", async () => {
    mockFindNodeByRepo.mockResolvedValue({
      nodeId: "owning-node-id",
      slug: "node-template",
    });

    const got = await resolveTargetNode(
      "github",
      githubBody("cogni-dao/node-template")
    );

    expect(mockFindNodeByRepo).toHaveBeenCalledWith(
      expect.anything(),
      "cogni-dao",
      "node-template"
    );
    expect(got).toEqual({
      nodeId: "owning-node-id",
      repo: "cogni-dao/node-template",
      fallbackToOperator: false,
    });
  });

  it("falls back to the operator node for an unregistered repo", async () => {
    mockFindNodeByRepo.mockResolvedValue(null);

    const got = await resolveTargetNode(
      "github",
      githubBody("cogni-test-org/unregistered")
    );

    expect(got).toEqual({
      nodeId: OPERATOR_NODE_ID,
      repo: "cogni-test-org/unregistered",
      fallbackToOperator: true,
    });
  });

  it("falls back to the operator node when the payload has no repository", async () => {
    const got = await resolveTargetNode("github", githubBody(undefined));

    expect(mockFindNodeByRepo).not.toHaveBeenCalled();
    expect(got).toEqual({
      nodeId: OPERATOR_NODE_ID,
      repo: null,
      fallbackToOperator: true,
    });
  });

  it("falls back to the operator node for non-github sources without a DB lookup", async () => {
    const got = await resolveTargetNode("alchemy", Buffer.from("{}", "utf-8"));

    expect(mockFindNodeByRepo).not.toHaveBeenCalled();
    expect(got).toEqual({
      nodeId: OPERATOR_NODE_ID,
      repo: null,
      fallbackToOperator: true,
    });
  });
});
