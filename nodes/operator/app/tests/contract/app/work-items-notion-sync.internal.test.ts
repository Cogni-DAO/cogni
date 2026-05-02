// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/work-items-notion-sync.internal`
 * Purpose: Contract tests for the internal Notion work-item sync endpoint.
 * Scope: Verifies bearer auth, configuration guard, request parsing, and response shape. Does not hit Notion or Dolt.
 * Invariants:
 *   - INTERNAL_OPS_AUTH: Missing/wrong bearer token -> 401
 *   - NOTION_SYNC_OPTIONAL: Missing sync env returns not-configured job error before external IO
 * Side-effects: none
 * Links: src/app/api/internal/work/notion/sync/route.ts
 * @internal
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_INTERNAL_OPS_TOKEN = "x".repeat(32);

const serverEnvMock = vi.fn(() => ({
  INTERNAL_OPS_TOKEN: TEST_INTERNAL_OPS_TOKEN,
}));

const runWorkItemsNotionSyncJob = vi.fn();

vi.mock("@/shared/env", () => ({
  serverEnv: () => serverEnvMock(),
}));

vi.mock("@/bootstrap/jobs/syncWorkItemsNotion.job", () => ({
  runWorkItemsNotionSyncJob: (...args: unknown[]) =>
    runWorkItemsNotionSyncJob(...args),
}));

vi.mock("@/bootstrap/http", () => ({
  wrapRouteHandlerWithLogging:
    (
      _options: unknown,
      handler: (
        ctx: {
          log: {
            warn: ReturnType<typeof vi.fn>;
            error: ReturnType<typeof vi.fn>;
            info: ReturnType<typeof vi.fn>;
          };
        },
        request: NextRequest
      ) => Promise<Response>
    ) =>
    async (request: NextRequest) =>
      handler(
        {
          log: {
            warn: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
          },
        },
        request
      ),
}));

import { POST } from "@/app/api/internal/work/notion/sync/route";

function createRequest(input: {
  token?: string;
  body?: string;
  contentType?: string;
}): NextRequest {
  const headers: Record<string, string> = {};
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  if (input.contentType) headers["content-type"] = input.contentType;

  return new NextRequest(
    "http://localhost:3000/api/internal/work/notion/sync",
    {
      method: "POST",
      headers,
      ...(input.body !== undefined && { body: input.body }),
    }
  );
}

describe("POST /api/internal/work/notion/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverEnvMock.mockReturnValue({
      INTERNAL_OPS_TOKEN: TEST_INTERNAL_OPS_TOKEN,
    });
    runWorkItemsNotionSyncJob.mockResolvedValue({
      scanned: 2,
      created: 1,
      updated: 1,
      appliedPatches: 0,
      conflicts: 0,
      skipped: 0,
      errors: [],
    });
  });

  it("returns 500 when INTERNAL_OPS_TOKEN is missing", async () => {
    serverEnvMock.mockReturnValue({});

    const res = await POST(createRequest({ token: TEST_INTERNAL_OPS_TOKEN }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Service not configured" });
    expect(runWorkItemsNotionSyncJob).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await POST(createRequest({}));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(runWorkItemsNotionSyncJob).not.toHaveBeenCalled();
  });

  it("returns 401 when token is invalid", async () => {
    const res = await POST(createRequest({ token: "wrong-token" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(runWorkItemsNotionSyncJob).not.toHaveBeenCalled();
  });

  it("passes a positive numeric limit to the sync job", async () => {
    const res = await POST(
      createRequest({
        token: TEST_INTERNAL_OPS_TOKEN,
        body: JSON.stringify({ limit: 25 }),
        contentType: "application/json",
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      scanned: 2,
      created: 1,
      updated: 1,
      errors: [],
    });
    expect(runWorkItemsNotionSyncJob).toHaveBeenCalledWith({ limit: 25 });
  });

  it("ignores malformed JSON and uses default sync options", async () => {
    const res = await POST(
      createRequest({
        token: TEST_INTERNAL_OPS_TOKEN,
        body: "{",
        contentType: "application/json",
      })
    );

    expect(res.status).toBe(200);
    expect(runWorkItemsNotionSyncJob).toHaveBeenCalledWith({});
  });
});
