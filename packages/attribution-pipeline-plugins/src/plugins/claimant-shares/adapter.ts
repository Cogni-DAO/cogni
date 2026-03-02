// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins/plugins/claimant-shares/adapter`
 * Purpose: Claimant-shares enricher adapter — reads attribution receipts, builds claimant-shares payload.
 * Scope: Implements EnricherAdapter port. Does not directly perform I/O — delegates to injected store.
 * Invariants:
 * - ENRICHER_IDEMPOTENT: same receipts + weight config produce same hashes and payload.
 * - EVALUATION_WRITE_VALIDATED: result includes evaluationRef, algoRef, inputsHash, schemaRef, payloadHash.
 * Side-effects: IO (reads from attributionStore via context)
 * Links: docs/spec/plugin-attribution-pipeline.md
 * @public
 */

import {
  buildDefaultReceiptClaimantSharesPayload,
  sha256OfCanonicalJson,
} from "@cogni/attribution-ledger";
import type {
  EnricherAdapter,
  EnricherContext,
  EnricherEvaluationResult,
} from "@cogni/attribution-pipeline-contracts";

import {
  CLAIMANT_SHARES_ALGO_REF,
  CLAIMANT_SHARES_EVALUATION_REF,
  CLAIMANT_SHARES_SCHEMA_REF,
} from "./descriptor";

async function evaluate(
  ctx: EnricherContext,
  status: "draft" | "locked"
): Promise<EnricherEvaluationResult> {
  const epoch = await ctx.attributionStore.getEpoch(ctx.epochId);
  if (!epoch) {
    throw new Error(`claimant-shares adapter: epoch ${ctx.epochId} not found`);
  }

  const receipts = await ctx.attributionStore.getSelectedReceiptsForAttribution(
    ctx.epochId
  );

  const payloadJson = buildDefaultReceiptClaimantSharesPayload({
    receipts,
    weightConfig: epoch.weightConfig,
  });

  const payloadHash = await sha256OfCanonicalJson(payloadJson);

  const inputsHash = await sha256OfCanonicalJson({
    epochId: ctx.epochId.toString(),
    weightConfig: epoch.weightConfig,
    receipts: receipts.map((receipt) => ({
      receiptId: receipt.receiptId,
      userId: receipt.userId,
      source: receipt.source,
      eventType: receipt.eventType,
      included: receipt.included,
      weightOverrideMilli: receipt.weightOverrideMilli?.toString() ?? null,
      platformUserId: receipt.platformUserId,
      payloadHash: receipt.payloadHash,
    })),
  });

  return {
    nodeId: ctx.nodeId,
    epochId: ctx.epochId,
    evaluationRef: CLAIMANT_SHARES_EVALUATION_REF,
    status,
    algoRef: CLAIMANT_SHARES_ALGO_REF,
    schemaRef: CLAIMANT_SHARES_SCHEMA_REF,
    inputsHash,
    payloadHash,
    payloadJson: payloadJson as unknown as Record<string, unknown>,
  };
}

/**
 * Create a claimant-shares enricher adapter.
 * Returns an EnricherAdapter that reads receipts and builds claimant-shares payloads.
 */
export function createClaimantSharesAdapter(): EnricherAdapter {
  return {
    evaluationRef: CLAIMANT_SHARES_EVALUATION_REF,
    evaluateDraft: (ctx) => evaluate(ctx, "draft"),
    buildLocked: (ctx) => evaluate(ctx, "locked"),
  };
}
