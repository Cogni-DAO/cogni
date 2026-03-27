// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/public/x402/chat/completions`
 * Purpose: x402-gated public Chat Completions endpoint. External agents pay USDC per-request.
 * Scope: Uses @x402/core x402HTTPResourceServer for protocol-correct payment lifecycle
 *   (verify before execution, settle before response, 402 on settlement failure).
 *   Delegates to existing chatCompletion facade for graph execution.
 * Invariants:
 *   - X402_INBOUND: Payment verified via facilitator before graph execution
 *   - SETTLE_BEFORE_RESPONSE: Settlement completes before response is sent to client
 *   - PUBLIC_NAMESPACE: Under /api/v1/public/* — bypasses session auth (proxy.ts)
 *   - LITELLM_IS_THE_METER: Outbound still uses LiteLLM (unchanged)
 *   - CALLBACK_IS_SOLE_WRITER: LiteLLM callback writes charge_receipts (unchanged)
 *   - Identity shim: synthetic SessionUser from wallet (task.0222 replaces with actor_id)
 * Side-effects: IO (HTTP, x402 facilitator, graph execution via Temporal)
 * Links: x402.chat.public.v1.contract, docs/spec/x402-e2e.md, task.0221, task.0222
 * @public
 */

import { v5 as uuidv5 } from "uuid";
import { NextResponse } from "next/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { x402HTTPResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { NextAdapter } from "@x402/next";

import { chatCompletion } from "@/app/_facades/ai/completion.server";
import { wrapPublicRoute } from "@/bootstrap/http";
import { chatCompletionsContract } from "@/contracts/x402.chat.public.v1.contract";
import {
  EVENT_NAMES,
  logEvent,
  logRequestWarn,
} from "@/shared/observability";
import type { SessionUser } from "@/shared/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────────────────────
// x402 Configuration
// Prototype: hardcoded from repo-spec payments_in.x402
// task.0120 (repo-spec reader) will make this dynamic
// ─────────────────────────────────────────────────────────────────────────────

const RECEIVING_ADDRESS = "0xdCCa8D85603C2CC47dc6974a790dF846f8695056";
const FACILITATOR_URL = "https://x402.org/facilitator";

// ─────────────────────────────────────────────────────────────────────────────
// x402 Resource Server (singleton — reused across requests)
// ─────────────────────────────────────────────────────────────────────────────

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "eip155:8453", // Base mainnet
  new ExactEvmScheme()
);

const routeConfig = {
  accepts: {
    scheme: "exact",
    payTo: RECEIVING_ADDRESS,
    price: "$0.10", // Max 0.10 USDC per request
    network: "eip155:8453",
  },
  description: "Cogni Node — AI graph execution via x402 USDC on Base",
  mimeType: "application/json",
};

const httpServer = new x402HTTPResourceServer(resourceServer, {
  "* *": routeConfig, // Catch-all — this route only serves one path
});

// ─────────────────────────────────────────────────────────────────────────────
// Identity shim (task.0222 replaces with actor_id)
// ─────────────────────────────────────────────────────────────────────────────

const X402_AGENT_NAMESPACE = "a8b9c0d1-e2f3-4a5b-6c7d-8e9f0a1b2c3d";

function walletToSessionUser(walletAddress: string): SessionUser {
  const id = uuidv5(walletAddress.toLowerCase(), X402_AGENT_NAMESPACE);
  return { id, walletAddress, displayName: null, avatarColor: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error helpers (OpenAI-compatible format)
// ─────────────────────────────────────────────────────────────────────────────

function openAiError(
  message: string,
  type: string,
  status: number,
  code: string | null = null
): NextResponse {
  return NextResponse.json(
    { error: { message, type, param: null, code } },
    { status }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler: wrapPublicRoute (rate limit + logging) + x402 payment gate
// ─────────────────────────────────────────────────────────────────────────────

export const POST = wrapPublicRoute(
  {
    routeId: "x402.chat.completions",
    cacheTtlSeconds: 0,
    staleWhileRevalidateSeconds: 0,
  },
  async (ctx, request) => {
    // ── Step 1: x402 payment processing via SDK ─────────────────────────
    // processHTTPRequest handles:
    // - PAYMENT-SIGNATURE / X-PAYMENT header detection
    // - 402 challenge generation if no payment
    // - Payment verification via facilitator
    const adapter = new NextAdapter(request);
    const paymentResult = await httpServer.processHTTPRequest({
      adapter,
      routeConfig,
    });

    // No payment header → return 402 challenge (SDK builds correct format)
    if (paymentResult.type === "payment-error") {
      logEvent(ctx.log, EVENT_NAMES.X402_CHALLENGE_RETURNED, {
        reqId: ctx.reqId,
        routeId: "x402.chat.completions",
        outcome: "challenge",
      });
      const { status, headers, body } = paymentResult.response;
      const response = NextResponse.json(body, { status });
      for (const [key, value] of Object.entries(headers)) {
        response.headers.set(key, value);
      }
      return response;
    }

    // Unexpected: no payment required (shouldn't happen — route is always gated)
    if (paymentResult.type === "no-payment-required") {
      ctx.log.warn("x402: processHTTPRequest returned no-payment-required");
      return openAiError("Payment required", "payment_error", 402);
    }

    // ── Step 2: Payment verified — extract payer address ────────────────
    const { paymentPayload, paymentRequirements } = paymentResult;

    // Extract payer from the verified payload
    const payerAddress =
      (paymentPayload as Record<string, unknown> & { payload?: { authorization?: { from?: string } } })
        ?.payload?.authorization?.from ??
      "0x0000000000000000000000000000000000000000";

    logEvent(ctx.log, EVENT_NAMES.X402_PAYMENT_VERIFIED, {
      reqId: ctx.reqId,
      routeId: "x402.chat.completions",
      outcome: "success",
    });

    // ── Step 3: Parse request body (OpenAI format) ──────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return openAiError(
        "Could not parse JSON body",
        "invalid_request_error",
        400
      );
    }

    const parseResult = chatCompletionsContract.input.safeParse(body);
    if (!parseResult.success) {
      logRequestWarn(ctx.log, parseResult.error, "VALIDATION_ERROR");
      return openAiError(
        parseResult.error.issues
          .map(
            (e) =>
              `${(e.path as Array<string | number>).join(".")}: ${e.message}`
          )
          .join("; "),
        "invalid_request_error",
        400
      );
    }
    const input = parseResult.data;

    // ── Step 4: Build identity shim ─────────────────────────────────────
    const sessionUser = walletToSessionUser(payerAddress);

    // ── Step 5: Execute graph via existing facade ───────────────────────
    const modelRef = {
      providerKey: "platform" as const,
      modelId: input.model,
    };

    let completionResult;
    try {
      completionResult = await chatCompletion(
        {
          messages: input.messages,
          modelRef,
          sessionUser,
          ...(input.graph_name ? { graphName: input.graph_name } : {}),
        },
        ctx
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Internal server error";
      logEvent(ctx.log, EVENT_NAMES.X402_EXECUTION_ERROR, {
        reqId: ctx.reqId,
        routeId: "x402.chat.completions",
        outcome: "error",
        errorCode: "execution_failed",
      });
      // Return error WITHOUT settling — per x402 protocol, don't settle on errors
      return openAiError(message, "server_error", 500);
    }

    // ── Step 6: Settle payment BEFORE returning response ────────────────
    // This is the critical x402 protocol requirement:
    // Settlement happens after execution succeeds but before the client gets the response.
    // If settlement fails, the client gets 402 — they don't get free inference.
    const settleResult = await httpServer.processSettlement(
      paymentPayload,
      paymentRequirements
    );

    if (!settleResult.success) {
      logEvent(ctx.log, EVENT_NAMES.X402_SETTLEMENT_FAILED, {
        reqId: ctx.reqId,
        routeId: "x402.chat.completions",
        outcome: "error",
        errorCode: "settlement_failed",
      });
      // Settlement failed → return 402, NOT the completion
      const { status, headers: settleHeaders, body: settleBody } = settleResult.response;
      const failResponse = NextResponse.json(settleBody, { status });
      for (const [key, value] of Object.entries(settleHeaders)) {
        failResponse.headers.set(key, value);
      }
      return failResponse;
    }

    logEvent(ctx.log, EVENT_NAMES.X402_SETTLEMENT_COMPLETE, {
      reqId: ctx.reqId,
      routeId: "x402.chat.completions",
      outcome: "success",
    });

    logEvent(ctx.log, EVENT_NAMES.AI_COMPLETION, {
      reqId: ctx.reqId,
      routeId: "x402.chat.completions",
      streaming: false,
      model: input.model,
      outcome: "success",
      finishReason: completionResult.choices[0]?.finish_reason ?? "stop",
      promptTokens: completionResult.usage.prompt_tokens,
      completionTokens: completionResult.usage.completion_tokens,
    });

    // ── Step 7: Return completion with x402 + settlement metadata ───────
    const response = NextResponse.json({
      ...completionResult,
      x402: {
        payerAddress,
        receivingAddress: RECEIVING_ADDRESS,
        chain: "base",
        asset: "USDC",
        settlementTx: settleResult.transaction,
      },
    });

    // Add PAYMENT-RESPONSE header (x402 protocol — base64-encoded settlement receipt)
    for (const [key, value] of Object.entries(settleResult.headers)) {
      response.headers.set(key, value);
    }

    return response;
  }
);
