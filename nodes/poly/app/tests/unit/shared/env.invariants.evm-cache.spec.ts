// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetEvmRpcConnectivityCacheForTest,
  checkEvmRpcConnectivity,
} from "@/shared/env/invariants";

const prodEnv = {
  APP_ENV: "production",
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app_user:x@h/db",
  DATABASE_SERVICE_URL: "postgresql://app_service:x@h/db",
  LITELLM_MASTER_KEY: "k",
} as const;

describe("checkEvmRpcConnectivity TTL cache", () => {
  beforeEach(() => {
    _resetEvmRpcConnectivityCacheForTest();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetEvmRpcConnectivityCacheForTest();
  });

  it("returns ok=true with source=skipped in test mode without calling client", async () => {
    const client = { getBlockNumber: vi.fn() };
    const result = await checkEvmRpcConnectivity(client, {
      ...prodEnv,
      APP_ENV: "test",
      NODE_ENV: "test",
    });
    expect(result).toEqual({ ok: true, source: "skipped" });
    expect(client.getBlockNumber).not.toHaveBeenCalled();
  });

  it("caches a successful probe for 60s, only one RPC call across many probes", async () => {
    const client = { getBlockNumber: vi.fn().mockResolvedValue(1234n) };

    const first = await checkEvmRpcConnectivity(client, prodEnv);
    expect(first).toEqual({ ok: true, source: "live" });

    // Many probes within 60s should all be cache hits
    for (let i = 0; i < 11; i++) {
      vi.advanceTimersByTime(5_000);
      // skip the boundary that crosses 60s
      if (i >= 11) break;
      const r = await checkEvmRpcConnectivity(client, prodEnv);
      if (i < 10) {
        expect(r).toEqual({ ok: true, source: "cached" });
      }
    }
    expect(client.getBlockNumber).toHaveBeenCalledTimes(1);

    // After TTL, refetches once
    vi.advanceTimersByTime(60_001);
    const refresh = await checkEvmRpcConnectivity(client, prodEnv);
    expect(refresh).toEqual({ ok: true, source: "live" });
    expect(client.getBlockNumber).toHaveBeenCalledTimes(2);
  });

  it("caches failures for 30s with error message preserved", async () => {
    const client = {
      getBlockNumber: vi.fn().mockRejectedValue(new Error("HTTP 429")),
    };

    const first = await checkEvmRpcConnectivity(client, prodEnv);
    expect(first.ok).toBe(false);
    expect(first.source).toBe("live");
    expect(first.errorMessage).toContain("429");

    vi.advanceTimersByTime(10_000);
    const cached = await checkEvmRpcConnectivity(client, prodEnv);
    expect(cached.ok).toBe(false);
    expect(cached.source).toBe("cached");
    expect(cached.errorMessage).toContain("429");
    expect(client.getBlockNumber).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_001);
    await checkEvmRpcConnectivity(client, prodEnv);
    expect(client.getBlockNumber).toHaveBeenCalledTimes(2);
  });

  it("flips back to ok after a recovered probe", async () => {
    const client = {
      getBlockNumber: vi
        .fn()
        .mockRejectedValueOnce(new Error("HTTP 429"))
        .mockResolvedValue(1234n),
    };

    const fail = await checkEvmRpcConnectivity(client, prodEnv);
    expect(fail.ok).toBe(false);

    vi.advanceTimersByTime(30_001);
    const ok = await checkEvmRpcConnectivity(client, prodEnv);
    expect(ok).toEqual({ ok: true, source: "live" });

    vi.advanceTimersByTime(5_000);
    const cached = await checkEvmRpcConnectivity(client, prodEnv);
    expect(cached).toEqual({ ok: true, source: "cached" });
  });
});
