// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/vcs.flight`
 * Purpose: Contract tests for POST /api/v1/vcs/flight.
 * Scope: Verifies PR CI gating, operator-local node-ref dispatch gating, and auth.
 * Invariants:
 *   - CI_GATE: PR and parent-pin PR checks must be green before dispatch.
 *   - NODE_REF_PARENT_PIN_GATE: parent pin PR head must match the prepared pin commit.
 *   - CONTRACTS_ARE_TRUTH: 202 response matches flightOperation.output schema.
 * Side-effects: none
 * Links: task.0361, nodes/operator/app/src/app/api/v1/vcs/flight/route.ts,
 *   packages/node-contracts/src/vcs.flight.v1.contract.ts
 * @internal
 */

import { flightOperation } from "@cogni/node-contracts";
import { TEST_SESSION_USER_1 } from "@tests/_fakes/ids";
import { testApiHandler } from "next-test-api-route-handler";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CandidateFlightDispatchResult,
  OperatorDeployCiStatus,
  PreparedNodeRefCandidateFlight,
} from "@/ports";

const NODE_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_SHA = "0123456789012345678901234567890123456789";

const mockDeployPlane = vi.hoisted(() => ({
  getCiStatus: vi.fn(),
  dispatchCandidateFlight: vi.fn(),
  prepareNodeRefCandidateFlight: vi.fn(),
  dispatchNodeRefCandidateFlight: vi.fn(),
}));

const dbState = vi.hoisted(() => ({
  current: {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "creative",
    ownerUserId: "00000000-0000-4000-a000-000000000001",
  } as { id: string; slug: string; ownerUserId: string } | null,
}));

const mockGetSessionUser = vi.hoisted(() => vi.fn());
const mockLog = vi.hoisted(() => ({
  child: vi.fn().mockReturnThis(),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/bootstrap/capabilities/operator-deploy-plane", () => ({
  createOperatorDeployPlane: () => mockDeployPlane,
}));

vi.mock("@/bootstrap/container", () => ({
  getContainer: () => ({
    log: mockLog,
    clock: { now: () => new Date("2025-01-01T00:00:00Z") },
    config: { unhandledErrorPolicy: "rethrow" },
  }),
  resolveAppDb: () => ({}),
}));

vi.mock("@/bootstrap/otel", () => ({
  withRootSpan: async (
    _name: string,
    _attrs: Record<string, string>,
    handler: (ctx: {
      traceId: string;
      span: { setAttribute: () => void };
    }) => Promise<unknown>
  ) =>
    handler({
      traceId: "trace-1",
      span: { setAttribute: vi.fn() },
    }),
}));

vi.mock("@/shared/config/repoSpec.server", () => ({
  getGithubRepo: () => ({ owner: "test-owner", repo: "test-repo" }),
}));

vi.mock("@/shared/env", () => ({
  serverEnv: () => ({
    GH_REVIEW_APP_ID: "1",
    GH_REVIEW_APP_PRIVATE_KEY_BASE64:
      Buffer.from("private-key").toString("base64"),
  }),
}));

vi.mock("@/app/_lib/auth/session", () => ({
  getSessionUser: () => mockGetSessionUser(),
}));

vi.mock("@cogni/db-client", () => ({
  withTenantScope: async (
    _db: unknown,
    _actor: unknown,
    run: (tx: unknown) => unknown
  ) => run(mockTx),
}));

const mockTx = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => (dbState.current ? [dbState.current] : []),
      }),
    }),
  }),
};

vi.mock("@/shared/observability", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/observability")>();
  return {
    ...actual,
    createRequestContext: () => ({
      log: mockLog,
      reqId: "req-1",
      routeId: "vcs.flight",
    }),
    logRequestEnd: vi.fn(),
    logRequestStart: vi.fn(),
    logRequestWarn: vi.fn(),
  };
});

import * as appHandler from "@/app/api/v1/vcs/flight/route";

function makeGreenCiStatus(
  overrides: Partial<OperatorDeployCiStatus> = {}
): OperatorDeployCiStatus {
  return {
    prNumber: 42,
    headSha: "abc123def456abc123def456abc123def456abc1",
    allGreen: true,
    pending: false,
    checks: [],
    ...overrides,
  };
}

function makeDispatchResult(
  message = "Flight dispatched"
): CandidateFlightDispatchResult {
  return {
    dispatched: true,
    workflowUrl:
      "https://github.com/test-owner/test-repo/actions/workflows/candidate-flight.yml",
    message,
  };
}

function makePreparedNodeRef(
  overrides: Partial<PreparedNodeRefCandidateFlight> = {}
): PreparedNodeRefCandidateFlight {
  return {
    nodeId: NODE_ID,
    slug: "creative",
    sourceSha: SOURCE_SHA,
    sourceRepo: "https://github.com/Cogni-DAO/creative.git",
    image: `ghcr.io/cogni-dao/creative-node:sha-${SOURCE_SHA}`,
    parentPin: {
      status: "already_pinned",
      currentSha: SOURCE_SHA,
    },
    ...overrides,
  };
}

describe("POST /api/v1/vcs/flight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.current = {
      id: NODE_ID,
      slug: "creative",
      ownerUserId: String(TEST_SESSION_USER_1.id),
    };
    mockGetSessionUser.mockResolvedValue(TEST_SESSION_USER_1);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSessionUser.mockResolvedValue(null);

    await testApiHandler({
      appHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prNumber: 42 }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 422 when PR CI is not green", async () => {
    mockDeployPlane.getCiStatus.mockResolvedValue(
      makeGreenCiStatus({ allGreen: false })
    );

    await testApiHandler({
      appHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prNumber: 42 }),
        });
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toMatch(/CI is not green/);
        expect(mockDeployPlane.dispatchCandidateFlight).not.toHaveBeenCalled();
      },
    });
  });

  it("returns 202 for a green PR flight", async () => {
    mockDeployPlane.getCiStatus.mockResolvedValue(makeGreenCiStatus());
    mockDeployPlane.dispatchCandidateFlight.mockResolvedValue(
      makeDispatchResult("Flight dispatched for PR #42 @ abc123de.")
    );

    await testApiHandler({
      appHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prNumber: 42 }),
        });
        expect(res.status).toBe(202);
        const body = await res.json();
        expect(flightOperation.output.safeParse(body).success).toBe(true);
        expect(body.prNumber).toBe(42);
        expect(mockDeployPlane.getCiStatus).toHaveBeenCalledWith({
          owner: "test-owner",
          repo: "test-repo",
          prNumber: 42,
        });
      },
    });
  });

  it("returns 202 for an already-pinned node-ref candidate flight", async () => {
    mockDeployPlane.prepareNodeRefCandidateFlight.mockResolvedValue(
      makePreparedNodeRef()
    );
    mockDeployPlane.dispatchNodeRefCandidateFlight.mockResolvedValue(
      makeDispatchResult("Candidate flight dispatched for creative@01234567.")
    );

    await testApiHandler({
      appHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeRef: { nodeId: NODE_ID, sourceSha: SOURCE_SHA },
          }),
        });
        expect(res.status).toBe(202);
        const body = await res.json();
        expect(flightOperation.output.safeParse(body).success).toBe(true);
        expect(body.nodeRef.slug).toBe("creative");
        expect(
          mockDeployPlane.dispatchNodeRefCandidateFlight
        ).toHaveBeenCalledWith({
          owner: "test-owner",
          repo: "test-repo",
          slug: "creative",
          sourceSha: SOURCE_SHA,
        });
      },
    });
  });

  it("returns 409 when parent pin PR CI head differs from prepared pin commit", async () => {
    mockDeployPlane.prepareNodeRefCandidateFlight.mockResolvedValue(
      makePreparedNodeRef({
        parentPin: {
          status: "pin_pr_opened",
          currentSha: null,
          prNumber: 77,
          prUrl: "https://github.com/test-owner/test-repo/pull/77",
          parentHeadSha: "1111111111111111111111111111111111111111",
        },
      })
    );
    mockDeployPlane.getCiStatus.mockResolvedValue(
      makeGreenCiStatus({
        prNumber: 77,
        headSha: "2222222222222222222222222222222222222222",
      })
    );

    await testApiHandler({
      appHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeRef: { nodeId: NODE_ID, sourceSha: SOURCE_SHA },
          }),
        });
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.expectedHeadSha).toBe(
          "1111111111111111111111111111111111111111"
        );
        expect(
          mockDeployPlane.dispatchNodeRefCandidateFlight
        ).not.toHaveBeenCalled();
      },
    });
  });

  it("returns 422 when parent pin PR CI is not green", async () => {
    mockDeployPlane.prepareNodeRefCandidateFlight.mockResolvedValue(
      makePreparedNodeRef({
        parentPin: {
          status: "pin_pr_opened",
          currentSha: "0000000000000000000000000000000000000000",
          prNumber: 77,
          prUrl: "https://github.com/test-owner/test-repo/pull/77",
          parentHeadSha: "1111111111111111111111111111111111111111",
        },
      })
    );
    mockDeployPlane.getCiStatus.mockResolvedValue(
      makeGreenCiStatus({
        prNumber: 77,
        headSha: "1111111111111111111111111111111111111111",
        allGreen: false,
      })
    );

    await testApiHandler({
      appHandler,
      async test({ fetch }) {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeRef: { nodeId: NODE_ID, sourceSha: SOURCE_SHA },
          }),
        });
        expect(res.status).toBe(422);
        expect(
          mockDeployPlane.dispatchNodeRefCandidateFlight
        ).not.toHaveBeenCalled();
      },
    });
  });
});
