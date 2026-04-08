// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import type { GraphRun } from "@cogni/scheduler-core";
import { TEST_SESSION_USER_1, TEST_USER_ID_1 } from "@tests/_fakes/ids";
import { testApiHandler } from "next-test-api-route-handler";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as appHandler from "@/app/api/v1/agent/runs/route";

function makeRun(overrides: Partial<GraphRun> = {}): GraphRun {
  return {
    id: "pk-1",
    scheduleId: null,
    runId: "run-1",
    graphId: "langgraph:default",
    runKind: "user_immediate",
    triggerSource: "api",
    triggerRef: null,
    requestedBy: TEST_USER_ID_1,
    scheduledFor: null,
    startedAt: new Date("2026-03-19T10:00:00Z"),
    completedAt: new Date("2026-03-19T10:00:05Z"),
    status: "success",
    attemptCount: 0,
    langfuseTraceId: null,
    errorCode: null,
    errorMessage: null,
    stateKey: "sk-abc",
    ...overrides,
  };
}

const mockListRunsByUser = vi.fn();

vi.mock("@/bootstrap/container", () => ({
  getContainer: vi.fn(() => ({
    log: {
      child: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      })),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    clock: { now: vi.fn(() => new Date("2025-01-01T00:00:00Z")) },
    config: { unhandledErrorPolicy: "rethrow" },
    graphRunRepository: {
      listRunsByUser: mockListRunsByUser,
    },
  })),
}));

vi.mock("@/app/_lib/auth/request-identity", () => ({
  resolveRequestIdentity: vi.fn().mockResolvedValue(TEST_SESSION_USER_1),
}));

describe("GET /api/v1/agent/runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with runs for machine-authenticated actor", async () => {
    mockListRunsByUser.mockResolvedValue([makeRun()]);

    await testApiHandler({
      appHandler,
      url: "/api/v1/agent/runs",
      async test({ fetch }) {
        const res = await fetch({
          method: "GET",
          headers: { authorization: "Bearer cogni_ag_sk_v1_test" },
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.runs).toHaveLength(1);
      },
    });
  });
});
