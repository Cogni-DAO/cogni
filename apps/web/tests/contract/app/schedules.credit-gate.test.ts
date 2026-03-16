// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/schedules.credit-gate`
 * Purpose: Verifies schedule creation credit gate — paid model + zero balance = 402, free model passes.
 * Scope: Route-level test with mocked container. Does not test database or Temporal.
 * Invariants:
 *   - SCHEDULE_CREATION_REJECTS_IF_CURRENTLY_UNPAYABLE: paid model + balance <= 0 = 402
 *   - Free model schedule creation succeeds regardless of balance
 *   - No model in input bypasses the credit gate (succeeds)
 * Side-effects: none
 * Links: src/app/api/v1/schedules/route.ts, bug.0025
 * @internal
 */

import { TEST_SESSION_USER_1 } from "@tests/_fakes/ids";
import { testApiHandler } from "next-test-api-route-handler";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock session authentication
vi.mock("@/app/_lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

// Mock model catalog
vi.mock("@/shared/ai/model-catalog.server", () => ({
  isModelFree: vi.fn(),
}));

const mockAccountService = {
  getOrCreateBillingAccountForUser: vi.fn(),
  getBalance: vi.fn(),
  getBillingAccount: vi.fn(),
  recordChargeReceipt: vi.fn(),
  listChargeReceipts: vi.fn(),
  getBalanceHistory: vi.fn(),
};

const mockScheduleManager = {
  createSchedule: vi.fn(),
  listSchedules: vi.fn(),
  getSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
};

// Mock bootstrap container
vi.mock("@/bootstrap/container", () => ({
  getContainer: vi.fn(() => ({
    log: {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
    config: {
      unhandledErrorPolicy: "rethrow",
    },
    accountsForUser: vi.fn(() => mockAccountService),
    scheduleManager: mockScheduleManager,
  })),
}));

// Import after mocks
import { getSessionUser } from "@/app/_lib/auth/session";
import * as appHandler from "@/app/api/v1/schedules/route";
import { isModelFree } from "@/shared/ai/model-catalog.server";

const VALID_SCHEDULE_BODY = {
  graphId: "langgraph:poet",
  input: { messages: [{ role: "user", content: "Hello" }], model: "gpt-4o" },
  cron: "0 9 * * *",
  timezone: "UTC",
};

const CREATED_SCHEDULE = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  graphId: "langgraph:poet",
  input: VALID_SCHEDULE_BODY.input,
  cron: "0 9 * * *",
  timezone: "UTC",
  enabled: true,
  nextRunAt: new Date("2026-01-18T09:00:00.000Z"),
  lastRunAt: null,
  createdAt: new Date("2026-01-18T00:00:00.000Z"),
  updatedAt: new Date("2026-01-18T00:00:00.000Z"),
};

describe("POST /api/v1/schedules - Credit Gate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSessionUser).mockResolvedValue(TEST_SESSION_USER_1);
    mockAccountService.getOrCreateBillingAccountForUser.mockResolvedValue({
      id: "ba-test",
      ownerUserId: TEST_SESSION_USER_1.id,
      defaultVirtualKeyId: "vk-test",
    });
    mockScheduleManager.createSchedule.mockResolvedValue(CREATED_SCHEDULE);
  });

  it("rejects paid model with zero balance → 402", async () => {
    vi.mocked(isModelFree).mockResolvedValue(false);
    mockAccountService.getBalance.mockResolvedValue(0);

    await testApiHandler({
      appHandler,
      test: async ({
        fetch,
      }: {
        fetch: (init?: RequestInit) => Promise<Response>;
      }) => {
        const response = await fetch({
          method: "POST",
          body: JSON.stringify(VALID_SCHEDULE_BODY),
        });

        expect(response.status).toBe(402);
        const json = await response.json();
        expect(json.error).toContain("Insufficient credits");

        // scheduleManager.createSchedule must NOT be called
        expect(mockScheduleManager.createSchedule).not.toHaveBeenCalled();
      },
    });
  });

  it("allows free model with zero balance → 201", async () => {
    vi.mocked(isModelFree).mockResolvedValue(true);
    mockAccountService.getBalance.mockResolvedValue(0);

    await testApiHandler({
      appHandler,
      test: async ({
        fetch,
      }: {
        fetch: (init?: RequestInit) => Promise<Response>;
      }) => {
        const response = await fetch({
          method: "POST",
          body: JSON.stringify({
            ...VALID_SCHEDULE_BODY,
            input: { ...VALID_SCHEDULE_BODY.input, model: "free-model" },
          }),
        });

        expect(response.status).toBe(201);
        expect(mockScheduleManager.createSchedule).toHaveBeenCalledTimes(1);
      },
    });
  });

  it("allows no-model input with zero balance → 201", async () => {
    mockAccountService.getBalance.mockResolvedValue(0);

    await testApiHandler({
      appHandler,
      test: async ({
        fetch,
      }: {
        fetch: (init?: RequestInit) => Promise<Response>;
      }) => {
        const response = await fetch({
          method: "POST",
          body: JSON.stringify({
            ...VALID_SCHEDULE_BODY,
            input: { messages: [] }, // no model field
          }),
        });

        expect(response.status).toBe(201);
        // isModelFree should not be called when model is absent
        expect(isModelFree).not.toHaveBeenCalled();
        expect(mockScheduleManager.createSchedule).toHaveBeenCalledTimes(1);
      },
    });
  });

  it("allows paid model with positive balance → 201", async () => {
    vi.mocked(isModelFree).mockResolvedValue(false);
    mockAccountService.getBalance.mockResolvedValue(1_000_000);

    await testApiHandler({
      appHandler,
      test: async ({
        fetch,
      }: {
        fetch: (init?: RequestInit) => Promise<Response>;
      }) => {
        const response = await fetch({
          method: "POST",
          body: JSON.stringify(VALID_SCHEDULE_BODY),
        });

        expect(response.status).toBe(201);
        expect(mockScheduleManager.createSchedule).toHaveBeenCalledTimes(1);
      },
    });
  });
});
