// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/preflight-credit-check.decorator`
 * Purpose: Decorator that wraps GraphExecutorPort with pre-execution credit validation.
 * Scope: Checks credit balance before any upstream event consumption. Does not execute graphs directly (delegates to inner).
 * Invariants:
 *   - CREDITS_ENFORCED_AT_EXECUTION_PORT: all execution paths get credit check automatically
 *   - PREFLIGHT_BEFORE_FIRST_YIELD: credit check completes before any upstream iteration
 *   - NO_FEATURES_IMPORT: adapters layer uses DI'd checkFn, never imports from features
 * Side-effects: IO (via injected checkFn → accountService.getBalance)
 * Links: GRAPH_EXECUTION.md, BillingGraphExecutorDecorator, preflight-credit-check.ts
 * @public
 */

import type { Logger } from "pino";
import type {
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
  PreflightCreditCheckFn,
} from "@/ports";
import type { AiEvent } from "@/types/ai-events";

/**
 * Decorator that wraps GraphExecutorPort with pre-execution credit validation.
 *
 * Runs an injected credit check function before yielding any upstream events.
 * If credits are insufficient, throws InsufficientCreditsPortError before
 * any LLM execution occurs.
 *
 * Stack position: between ObservabilityGraphExecutorDecorator (outer) and
 * BillingGraphExecutorDecorator (inner). This ensures:
 * - Observability traces the preflight failure
 * - Billing never fires for rejected runs
 */
export class PreflightCreditCheckDecorator implements GraphExecutorPort {
  constructor(
    private readonly inner: GraphExecutorPort,
    private readonly checkFn: PreflightCreditCheckFn,
    _log: Logger
  ) {}

  runGraph(req: GraphRunRequest): GraphRunResult {
    const result = this.inner.runGraph(req);

    // Start credit check eagerly (runs in parallel with any sync setup)
    const checkPromise = this.checkFn(
      req.caller.billingAccountId,
      req.model,
      req.messages
    );

    return {
      stream: this.wrapWithPreflight(result.stream, checkPromise),
      // If preflight fails, final rejects with same error (no billing fires)
      final: checkPromise.then(() => result.final),
    };
  }

  private async *wrapWithPreflight(
    upstream: AsyncIterable<AiEvent>,
    checkPromise: Promise<void>
  ): AsyncIterable<AiEvent> {
    // Credit check MUST complete before consuming ANY upstream events
    // Per PREFLIGHT_BEFORE_FIRST_YIELD: no accidental upstream peek or buffering
    await checkPromise;
    yield* upstream;
  }
}
