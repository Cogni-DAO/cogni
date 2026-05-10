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
 *   - WINDOW_ONLY_APPLIES_TO_VOLUME: active USDC is a current-position fact;
 *     fill volume is windowed.
 *   - NO_BUCKET_PNL: per-bucket PnL is intentionally absent (bug.5020).
 *     Unrealized P/L on currently-open positions is misleading next to the
 *     vendor-authoritative net P/L on the P/L tab line chart, which sources
 *     `poly_trader_user_pnl_points`. Net P/L is per-wallet; bucketing it by
 *     condition is structurally meaningless. The Target Overlap surface
 *     reports exposure (USDC, markets, positions) and fill volume only.
 * Side-effects: none
 * Links: docs/spec/poly-copy-trade-execution.md, work/items/bug.5020
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
  fillVolumeUsdc: z.number(),
  rn1: z.object({
    marketCount: z.number().int().nonnegative(),
    positionCount: z.number().int().nonnegative(),
    currentValueUsdc: z.number(),
    fillVolumeUsdc: z.number(),
  }),
  swisstony: z.object({
    marketCount: z.number().int().nonnegative(),
    positionCount: z.number().int().nonnegative(),
    currentValueUsdc: z.number(),
    fillVolumeUsdc: z.number(),
  }),
});
export type PolyResearchTargetOverlapBucket = z.infer<
  typeof PolyResearchTargetOverlapBucketSchema
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
