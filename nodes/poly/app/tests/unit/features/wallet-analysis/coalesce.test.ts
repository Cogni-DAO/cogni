// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/coalesce` tests
 * Purpose: Pin the three behaviours of `coalesce`: TTL freshness, concurrent dedupe, failure-not-cached.
 * Scope: Pure module-level cache. Does not test routes, services, or upstream I/O.
 * Invariants: Tests reset module state via `clearTtlCache()` between specs; all timing uses fake timers.
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md
 * @internal
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearTtlCache,
  coalesce,
  ttlCacheSize,
} from "@/features/wallet-analysis/server/coalesce";

describe("coalesce", () => {
  beforeEach(() => {
    clearTtlCache();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the cached value within TTL — fetcher is called once", async () => {
    const fetcher = vi.fn(async () => "v");
    const a = await coalesce("k", fetcher, 1_000);
    const b = await coalesce("k", fetcher, 1_000);
    expect(a).toBe("v");
    expect(b).toBe("v");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after TTL expiry", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => Math.random());
    const v1 = await coalesce("k", fetcher, 1_000);
    vi.advanceTimersByTime(1_500);
    const v2 = await coalesce("k", fetcher, 1_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(v1).not.toBe(v2);
  });

  it("dedupes concurrent callers — N callers share one fetcher invocation", async () => {
    let resolve!: (v: string) => void;
    const promise = new Promise<string>((r) => {
      resolve = r;
    });
    const fetcher = vi.fn(() => promise);
    const callers = Array.from({ length: 10 }, () =>
      coalesce("k", fetcher, 1_000)
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve("v");
    const values = await Promise.all(callers);
    expect(values.every((v) => v === "v")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not cache failed fetcher results — next caller retries", async () => {
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("nope"))
      .mockResolvedValueOnce("ok");
    await expect(coalesce("k", fetcher, 1_000)).rejects.toThrow("nope");
    expect(ttlCacheSize()).toBe(0);
    const v = await coalesce("k", fetcher, 1_000);
    expect(v).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("isolates keys — cache miss on one key does not see another", async () => {
    const f1 = vi.fn(async () => "a");
    const f2 = vi.fn(async () => "b");
    const v1 = await coalesce("k1", f1, 1_000);
    const v2 = await coalesce("k2", f2, 1_000);
    expect(v1).toBe("a");
    expect(v2).toBe("b");
    expect(ttlCacheSize()).toBe(2);
  });
});
