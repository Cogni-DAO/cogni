// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core/enricher-inputs`
 * Purpose: Shared inputsHash computation for enrichers. Base shape is frozen; enrichers extend via `extensions`.
 * Scope: Pure function. Does not perform I/O.
 * Invariants:
 * - INPUTS_HASH_DETERMINISTIC: Same inputs → same hash, regardless of event order.
 * - INPUTS_HASH_EXTENSIBLE: Extensions are additive, sorted by canonicalJsonStringify.
 * Side-effects: none
 * Links: work/items/task.0113.epoch-artifact-pipeline.md
 * @public
 */

import { sha256OfCanonicalJson } from "./hashing";

/**
 * Compute a deterministic inputsHash for an enricher run.
 *
 * Base shape: epochId + sorted (eventId, eventPayloadHash) pairs.
 * Extensions: enricher-specific additions (e.g. frontmatter hashes for work-item-linker).
 * canonicalJsonStringify sorts keys, so extensions are stable.
 *
 * @param params.epochId - The epoch being enriched
 * @param params.events - Events with their ingestion-time payload hashes
 * @param params.extensions - Optional enricher-specific data to include in hash
 * @returns SHA-256 hex string
 */
export async function computeEnricherInputsHash(params: {
  epochId: bigint;
  events: ReadonlyArray<{
    eventId: string;
    eventPayloadHash: string;
  }>;
  extensions?: Record<string, unknown>;
}): Promise<string> {
  const sorted = [...params.events].sort((a, b) =>
    a.eventId.localeCompare(b.eventId)
  );
  const base: Record<string, unknown> = {
    epochId: params.epochId.toString(),
    events: sorted.map((e) => [e.eventId, e.eventPayloadHash]),
  };
  if (params.extensions) {
    base.ext = params.extensions;
  }
  return sha256OfCanonicalJson(base);
}
