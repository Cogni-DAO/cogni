// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/observation-helpers`
 * Purpose: Shared helper(s) used by observation-tick writers that mirror
 *          Polymarket facts into our DB read-model.
 * Scope: Pure utilities. No DB, no IO. Callers compose into writers.
 * Invariants:
 *   - DEDUPE_BEFORE_UPSERT: every writer that does `INSERT … ON CONFLICT DO UPDATE`
 *     dedupes its input array first by the conflict-target key. Postgres rejects
 *     ON CONFLICT batches that hit the same target row twice
 *     ("command cannot affect row a second time" — bug.5011).
 * Side-effects: none
 * Links: work/items/task.5012, work/items/bug.5011
 * @public
 */

/**
 * Last-write-wins dedupe by composite key. Returns a new array containing the
 * *last* occurrence per key, in insertion order of those last occurrences.
 *
 * Use before `INSERT … ON CONFLICT DO UPDATE` whenever upstream may emit
 * duplicate rows in a single payload (e.g. Polymarket /user-pnl returns the
 * current bucket twice during the active period).
 */
export function dedupeByKey<T, K>(
  rows: readonly T[],
  keyFn: (row: T) => K
): T[] {
  const map = new Map<K, T>();
  for (const row of rows) {
    map.set(keyFn(row), row);
  }
  return Array.from(map.values());
}
