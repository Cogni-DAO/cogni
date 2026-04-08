// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/public.models`
 * Purpose: Contract tests for GET /api/v1/public/models endpoint.
 * Scope: Validates HTTP behavior and response shape. Does not test real LiteLLM connection.
 * Invariants: 200 on success; 503 on upstream timeout; master key never in response.
 * Side-effects: none (fetch mocked)
 * Links: /api/v1/public/models route
 * @public
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock rate limiter to always allow requests
vi.mock("@/bootstrap/http/rateLimiter", () => ({
  publicApiLimiter: { consume: vi.fn(() => true) },
  extractClientIp: vi.fn(() => "test-ip"),
  TokenBucketRateLimiter: vi.fn(),
}));

// Mock container
vi.mock("@/bootstrap/container", () => ({
  getContainer: vi.fn(() => ({
    log: {
      child: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      })),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    clock: { now: () => new Date() },
    config: {
      unhandledErrorPolicy: "rethrow",
      rateLimitBypass: {
        enabled: false,
        headerName: "x-stack-test",
        headerValue: "1",
      },
      DEPLOY_ENVIRONMENT: "test",
    },
  })),
}));

// Mock serverEnv with LiteLLM config
vi.mock("@/shared/env", () => ({
  serverEnv: () => ({
    LITELLM_BASE_URL: "http://litellm-test:4000",
    LITELLM_MASTER_KEY: "test-master-key",
  }),
}));

import { GET } from "@/app/api/v1/public/models/route";

const MOCK_LITELLM_MODELS = {
  data: [
    { id: "gpt-4o-mini", object: "model" },
    { id: "claude-opus-4.5", object: "model" },
    { id: "claude-sonnet-4.5", object: "model" },
  ],
  object: "list",
};

function makeReq() {
  return new NextRequest("http://localhost:3000/api/v1/public/models");
}

describe("GET /api/v1/public/models contract tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns 200 with model list on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_LITELLM_MODELS,
      })
    );

    const res = await GET(makeReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveProperty("data");
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("calls LiteLLM /models with Authorization header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_LITELLM_MODELS,
    });
    vi.stubGlobal("fetch", mockFetch);

    await GET(makeReq());

    expect(mockFetch).toHaveBeenCalledWith(
      "http://litellm-test:4000/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-master-key" },
      })
    );
  });

  it("returns 503 when LiteLLM is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );

    const res = await GET(makeReq());
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data).toHaveProperty("error");
    expect(data).toHaveProperty("hint");
  });

  it("returns 502 when LiteLLM returns a non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );

    const res = await GET(makeReq());
    expect(res.status).toBe(502);
  });

  it("never leaks LITELLM_MASTER_KEY in response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_LITELLM_MODELS,
      })
    );

    const res = await GET(makeReq());
    const text = await res.text();

    expect(text).not.toContain("test-master-key");
  });

  it("includes cache-control header on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_LITELLM_MODELS,
      })
    );

    const res = await GET(makeReq());

    expect(res.headers.get("Cache-Control")).toContain("public");
    expect(res.headers.get("Cache-Control")).toContain("max-age=60");
  });
});
