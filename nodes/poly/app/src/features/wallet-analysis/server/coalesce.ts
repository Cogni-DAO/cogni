// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/coalesce`
 * Purpose: Tiny module-scoped TTL cache that also coalesces concurrent requests for the same key — N callers waiting on the same key share one in-flight fetch.
 * Scope: Pure utility. Does not know about wallets, slices, HTTP, or React. Module-scope state means one instance per Node process; cache survives only while the process lives.
 * Invariants:
 *   - SINGLE_REPLICA: cache lives in-process; corruption on >1 replica is asserted at boot in `instrumentation.ts`.
 *   - CONCURRENT_DEDUP: simultaneous calls for the same key resolve to one fetcher invocation.
 *   - FAILED_FETCH_NOT_CACHED: rejected fetchers are evicted so the next caller retries.
 * Side-effects: holds a Map in module scope; no I/O of its own.
 * Notes: Use `clearTtlCache()` in tests to reset module state between specs.
 * Links: docs/design/wallet-analysis-components.md
 * @public
 */

type Entry<T> = {
  value?: T;
  expiresAt?: number;
  inFlight?: Promise<T>;
};

const cache = new Map<string, Entry<unknown>>();

/**
 * Get-or-fetch with a TTL window and concurrent-dedupe.
 *
 * Behaviour:
 *  1. If a fresh value exists for `key`, return it immediately.
 *  2. If a fetch is already in flight for `key`, await that same promise.
 *  3. Otherwise invoke `fetcher()`, store the in-flight promise, and on
 *     success cache the value with `expiresAt = now + ttlMs`. On failure
 *     evict so the next caller retries.
 */
export async function coalesce<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key) as Entry<T> | undefined;

  if (existing?.value !== undefined && (existing.expiresAt ?? 0) > now) {
    return existing.value;
  }
  if (existing?.inFlight) {
    return existing.inFlight;
  }

  const promise = (async () => {
    try {
      const value = await fetcher();
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } catch (err) {
      cache.delete(key);
      throw err;
    }
  })();

  cache.set(key, { inFlight: promise });
  return promise;
}

/** Test-only: drop all cache state. */
export function clearTtlCache(): void {
  cache.clear();
}

/** Test-only: how many keys are currently cached (in-flight or warm). */
export function ttlCacheSize(): number {
  return cache.size;
}
