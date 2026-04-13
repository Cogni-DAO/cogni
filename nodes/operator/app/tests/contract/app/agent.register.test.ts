// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/agent.register`
 * Purpose: Contract test for POST /api/v1/agent/register — validates the
 *   wrapped, instrumented registration handler. Container mock matches the
 *   shape wrapRouteHandlerWithLogging reads (log.child, clock.now, config).
 * Scope: Mocks only infrastructure leaves (DB, container, token issuer).
 *   Does NOT mock any auth resolver — the route runs in auth mode "none".
 * Links: src/app/api/v1/agent/register/route.ts
 * @public
 */

import { testApiHandler } from "next-test-api-route-handler";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInsertValues = vi.fn();
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
const mockLimit = vi.fn().mockResolvedValue([{ id: "user-1" }]);
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockGetOrCreate = vi.fn().mockResolvedValue({ id: "billing-1" });

vi.mock("@/app/_lib/auth/request-identity", () => ({
  issueAgentApiKey: vi.fn(() => "cogni_ag_sk_v1_test"),
}));

// Container shape must satisfy both the route body (resolveServiceDb,
// serviceAccountService.getOrCreateBillingAccountForUser) AND the
// wrapRouteHandlerWithLogging envelope (log.child, clock.now, config).
vi.mock("@/bootstrap/container", () => {
  const childLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
  const log = {
    child: vi.fn(() => childLogger),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
  return {
    resolveServiceDb: vi.fn(() => ({
      insert: mockInsert,
      select: mockSelect,
    })),
    getContainer: vi.fn(() => ({
      log,
      clock: { now: vi.fn(() => new Date("2026-01-01T00:00:00Z")) },
      config: { unhandledErrorPolicy: "rethrow" },
      serviceAccountService: {
        getOrCreateBillingAccountForUser: mockGetOrCreate,
      },
    })),
  };
});

import * as appHandler from "@/app/api/v1/agent/register/route";

describe("POST /api/v1/agent/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue([{ id: "user-1" }]);
  });

  it("returns 201 with actor credentials", async () => {
    await testApiHandler({
      appHandler,
      url: "/api/v1/agent/register",
      async test({ fetch }) {
        const response = await fetch({
          method: "POST",
          body: JSON.stringify({ name: "test-agent" }),
          headers: { "content-type": "application/json" },
        });

        expect(response.status).toBe(201);
        const json = await response.json();
        expect(json.actorId).toMatch(/^user:/);
        expect(json.userId).toBeTypeOf("string");
        expect(json.apiKey).toContain("cogni_ag_sk_v1_");
        expect(json.billingAccountId).toBe("billing-1");
      },
    });
  });

  it("returns 400 for invalid payload", async () => {
    await testApiHandler({
      appHandler,
      url: "/api/v1/agent/register",
      async test({ fetch }) {
        const response = await fetch({
          method: "POST",
          body: JSON.stringify({ name: "" }),
          headers: { "content-type": "application/json" },
        });

        expect(response.status).toBe(400);
      },
    });
  });
});
