// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.copy-trade.targets.v1.contract`
 * Purpose: Contracts for managing the calling user's Polymarket copy-trade tracked wallets.
 *          List (GET), create (POST), delete (DELETE) — all RLS-scoped to the session user.
 * Scope: Schema-only. Does not execute trades, does not modify on-chain state, does not own
 *        target-resolution logic (lives in `CopyTradeTargetSource`).
 * Invariants:
 *   - TENANT_SCOPED: rows are RLS-clamped to `created_by_user_id = current_setting('app.current_user_id', true)`.
 *     Cross-tenant reads/writes blocked at the DB layer.
 *   - NO_KILL_SWITCH (bug.0438): there is no per-tenant kill-switch field on
 *     the wire. The act of POSTing a target IS the user's opt-in; DELETE of
 *     the target row is the only way to stop mirror placements.
 *   - SOURCE_REFLECTS_PORT: the `source` field reflects which `CopyTradeTargetSource` impl
 *     produced the row (`"env"` for the local-dev fallback, `"db"` for production).
 * Side-effects: none
 * Notes: Phase B will add per-tenant caps/mode from `poly_wallet_grants`. For now those
 *        fields surface the operator-wide hardcoded scaffolding values.
 * Links: docs/spec/poly-multi-tenant-auth.md, work/items/task.0318
 * @public
 */

import { z } from "zod";

const targetSchema = z.object({
  /**
   * `poly_copy_trade_targets.id` — DB row PK uuid. Pass this value to
   * `DELETE /api/v1/poly/copy-trade/targets/:id`. Distinct from the deterministic
   * UUIDv5 derived from `target_wallet` that lives in the fills ledger's
   * `target_id` column for `client_order_id` correlation; that value is internal.
   */
  target_id: z.string().uuid(),
  /** 0x-prefixed 40-hex — the wallet being watched / copied. */
  target_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** `"paper"` = shadow into paper_orders (P3); `"live"` = real Polymarket placement. */
  mode: z.enum(["paper", "live"]),
  /** Fixed mirror notional per fill (USDC). Operator-wide scaffolding in Phase A. */
  mirror_usdc: z.number().positive(),
  /** Provenance: `"env"` for the local-dev fallback; `"db"` once `dbTargetSource` is wired. */
  source: z.enum(["env", "db"]),
});

export const polyCopyTradeTargetsOperation = {
  id: "poly.copy-trade.targets.v1",
  summary: "List wallets the calling user is monitoring / copy-trading",
  description:
    "Returns the calling user's tracked wallets. RLS-scoped: a user sees only their own rows.",
  input: z.object({}),
  output: z.object({
    targets: z.array(targetSchema),
  }),
} as const;

const targetCreateInputSchema = z.object({
  target_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export const polyCopyTradeTargetCreateOperation = {
  id: "poly.copy-trade.targets.create.v1",
  summary: "Add a wallet to the calling user's tracked list",
  description:
    "Creates a new `poly_copy_trade_targets` row owned by the session user. Tenant-scoped via RLS. Returns the created row in the same shape as GET.",
  input: targetCreateInputSchema,
  output: z.object({
    target: targetSchema,
  }),
} as const;

export const polyCopyTradeTargetDeleteOperation = {
  id: "poly.copy-trade.targets.delete.v1",
  summary: "Remove a wallet from the calling user's tracked list",
  description:
    "Soft-deletes a `poly_copy_trade_targets` row by setting `disabled_at`. Tenant-scoped via RLS — a user cannot delete another user's row (returns 404).",
  input: z.object({ id: z.string().uuid() }),
  output: z.object({
    deleted: z.boolean(),
  }),
} as const;

export type PolyCopyTradeTarget = z.infer<typeof targetSchema>;
export type PolyCopyTradeTargetsOutput = z.infer<
  typeof polyCopyTradeTargetsOperation.output
>;
export type PolyCopyTradeTargetCreateInput = z.infer<
  typeof polyCopyTradeTargetCreateOperation.input
>;
export type PolyCopyTradeTargetCreateOutput = z.infer<
  typeof polyCopyTradeTargetCreateOperation.output
>;
export type PolyCopyTradeTargetDeleteOutput = z.infer<
  typeof polyCopyTradeTargetDeleteOperation.output
>;
