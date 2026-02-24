// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core/hashing`
 * Purpose: Deterministic SHA-256 hashing for allocation sets.
 * Scope: Pure functions. Does not perform network I/O or hold secrets.
 * Invariants:
 * - PAYOUT_DETERMINISTIC: Same inputs → byte-for-byte identical hash output.
 * - Allocations are canonically sorted before hashing.
 * Side-effects: none (uses Web Crypto API)
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

/**
 * Compute SHA-256 hash of a UTF-8 string.
 * Returns lowercase hex string.
 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute a deterministic SHA-256 hash of a weight config object.
 * Canonical JSON: keys sorted, values as-is. Deterministic for same config.
 *
 * @param config - Weight config (key → milli-unit value)
 * @returns SHA-256 hex string
 */
export async function computeWeightConfigHash(
  config: Record<string, number>
): Promise<string> {
  const sortedKeys = Object.keys(config).sort();
  const canonical: Record<string, number> = {};
  for (const key of sortedKeys) {
    canonical[key] = config[key] as number;
  }
  return sha256Hex(JSON.stringify(canonical));
}

/**
 * Compute a deterministic hash of a set of allocations for epoch close.
 *
 * Canonical format: sort allocations by userId, then serialize as
 * `userId:valuationUnits` lines joined by newline. This ensures
 * identical allocation sets always produce the same hash.
 *
 * @param allocations - Array of { userId, valuationUnits } to hash
 * @returns SHA-256 hex string
 */
export async function computeAllocationSetHash(
  allocations: ReadonlyArray<{
    readonly userId: string;
    readonly valuationUnits: bigint;
  }>
): Promise<string> {
  const sorted = [...allocations].sort((a, b) =>
    a.userId.localeCompare(b.userId)
  );
  const canonical = sorted
    .map((a) => `${a.userId}:${a.valuationUnits.toString()}`)
    .join("\n");
  return sha256Hex(canonical);
}
