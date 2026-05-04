// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.research-target-overlap.v1`
 * Purpose: Contract for the RN1/swisstony shared-market overlap research slice.
 * Scope: Read-only response shape for saved trader facts. Does not fetch or
 * mutate upstream Polymarket state.
 * Invariants:
 *   - ACTIVE_POSITIONS_DEFINE_OVERLAP: overlap buckets are built from current
 *     saved active positions by condition_id.
 *   - WINDOW_ONLY_APPLIES_TO_VOLUME: active USDC and PnL are current-position
 *     facts; fill volume is windowed.
 * Side-effects: none
 * Links: docs/design/poly-copy-target-performance-benchmark.md, work/items/task.5005
 * @public
 */

import { z } from "zod";
import { PolyWalletOverviewIntervalSchema } from "./poly.wallet.overview.v1.contract";

export const PolyResearchTargetOverlapBucketSchema = z.object({
  key: z.enum(["rn1_only", "shared", "swisstony_only"]),
  label: z.string(),
  marketCount: z.number().int().nonnegative(),
  positionCount: z.number().int().nonnegative(),
  currentValueUsdc: z.number(),
  costBasisUsdc: z.number(),
  pnlUsdc: z.number(),
  fillVolumeUsdc: z.number(),
  rn1: z.object({
    marketCount: z.number().int().nonnegative(),
    positionCount: z.number().int().nonnegative(),
    currentValueUsdc: z.number(),
    pnlUsdc: z.number(),
    fillVolumeUsdc: z.number(),
  }),
  swisstony: z.object({
    marketCount: z.number().int().nonnegative(),
    positionCount: z.number().int().nonnegative(),
    currentValueUsdc: z.number(),
    pnlUsdc: z.number(),
    fillVolumeUsdc: z.number(),
  }),
});
export type PolyResearchTargetOverlapBucket = z.infer<
  typeof PolyResearchTargetOverlapBucketSchema
>;

export const PolyResearchTargetOverlapPolicySchema = z.object({
  signal: z.enum(["shared_outperforms", "solo_outperforms", "insufficient"]),
  sharedPnlPerDollar: z.number().nullable(),
  soloPnlPerDollar: z.number().nullable(),
  note: z.string(),
});
export type PolyResearchTargetOverlapPolicy = z.infer<
  typeof PolyResearchTargetOverlapPolicySchema
>;

export const PolyResearchTargetOverlapResponseSchema = z.object({
  window: PolyWalletOverviewIntervalSchema,
  computedAt: z.string(),
  wallets: z.object({
    rn1: z.object({
      label: z.literal("RN1"),
      address: z.string(),
      observed: z.boolean(),
    }),
    swisstony: z.object({
      label: z.literal("swisstony"),
      address: z.string(),
      observed: z.boolean(),
    }),
  }),
  buckets: z.array(PolyResearchTargetOverlapBucketSchema),
  policy: PolyResearchTargetOverlapPolicySchema,
});
export type PolyResearchTargetOverlapResponse = z.infer<
  typeof PolyResearchTargetOverlapResponseSchema
>;

export const PolyResearchTargetOverlapQuerySchema = z.object({
  interval: PolyWalletOverviewIntervalSchema.optional().default("ALL"),
});
export type PolyResearchTargetOverlapQuery = z.infer<
  typeof PolyResearchTargetOverlapQuerySchema
>;
