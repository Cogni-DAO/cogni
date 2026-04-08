// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { testApiHandler } from "next-test-api-route-handler";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as appHandler from "@/app/api/v1/agent/register/route";

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

vi.mock("@/bootstrap/container", () => ({
  resolveServiceDb: vi.fn(() => ({
    insert: mockInsert,
    select: mockSelect,
  })),
  getContainer: vi.fn(() => ({
    serviceAccountService: {
      getOrCreateBillingAccountForUser: mockGetOrCreate,
    },
  })),
}));

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
