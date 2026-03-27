// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/x402.chat.public.v1.contract`
 * Purpose: x402-gated public Chat Completions API contract (POST /v1/public/x402/chat/completions).
 * Scope: Reuses the OpenAI-compatible request/response shapes from ai.completions.v1.contract.
 *   Adds x402 payment challenge response schema. Does not contain business logic.
 * Invariants:
 *   - CONTRACTS_FIRST: Request/response shapes defined here before implementation
 *   - Request body is identical to chatCompletionsContract.input (OpenAI format)
 *   - 402 response follows x402 protocol (paymentRequirements array)
 * Side-effects: none
 * Links: ai.completions.v1.contract, docs/spec/x402-e2e.md
 * @public
 */

import { z } from "zod";

// Re-export the OpenAI request/response contract — x402 endpoint uses the same body format
export { chatCompletionsContract } from "./ai.completions.v1.contract";

// ─────────────────────────────────────────────────────────────────────────────
// x402 Payment Challenge (402 response)
// ─────────────────────────────────────────────────────────────────────────────

const PaymentRequirementSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  maxAmountRequired: z.string(),
  resource: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number().int(),
  asset: z.string(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

const PaymentRequiredResponseSchema = z.object({
  x402Version: z.number().int(),
  error: z.string(),
  accepts: z.array(PaymentRequirementSchema),
});

export const x402PaymentContract = {
  id: "x402.chat.public.v1",
  summary: "x402-gated public Chat Completions API",
  description:
    "OpenAI-compatible chat completions gated by x402 USDC payment on Base. " +
    "Returns 402 Payment Required when X-PAYMENT header is missing or invalid.",
  paymentRequired: PaymentRequiredResponseSchema,
} as const;

// ── Inferred types ──────────────────────────────────────────────────────────

export type PaymentRequirement = z.infer<typeof PaymentRequirementSchema>;
export type PaymentRequiredResponse = z.infer<
  typeof PaymentRequiredResponseSchema
>;
