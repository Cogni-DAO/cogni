// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/billing-executor.decorator`
 * Purpose: Decorator that wraps GraphExecutorPort with billing validation and usage_report consumption.
 * Scope: Intercepts usage_report events from the stream, validates via Zod schemas. Does not write receipts — the LiteLLM callback is the sole receipt writer.
 * Invariants:
 *   - CALLBACK_IS_SOLE_WRITER: LiteLLM callback is sole receipt writer (PR bug.0057)
 *   - BILLING_INDEPENDENT_OF_CLIENT: validation fires during stream iteration, not on client connection
 *   - USAGE_FACT_VALIDATED: Zod validation at ingestion boundary (strict for inproc/sandbox, hints for external)
 * Side-effects: none (validation + event consumption only)
 * Links: GRAPH_EXECUTION.md, ObservabilityGraphExecutorDecorator, billing callback route
 * @public
 */

import { UsageFactHintsSchema, UsageFactStrictSchema } from "@cogni/ai-core";
import type { Logger } from "pino";
import type {
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
} from "@/ports";
import type { AiEvent } from "@/types/ai-events";
import type { UsageFact } from "@/types/usage";

/**
 * Decorator that wraps GraphExecutorPort with billing validation.
 *
 * Intercepts `usage_report` events from the upstream stream and validates the
 * UsageFact via Zod (strict for billing-authoritative executors, hints for
 * external).
 *
 * `usage_report` events are consumed by the decorator and NOT yielded to
 * the downstream consumer — billing events are invisible to callers.
 *
 * Receipt writes are handled exclusively by the LiteLLM callback
 * (CALLBACK_IS_SOLE_WRITER). This decorator validates but does not persist.
 *
 * Caller MUST consume `stream` to completion for validation side-effects to fire.
 */
export class BillingGraphExecutorDecorator implements GraphExecutorPort {
  constructor(
    private readonly inner: GraphExecutorPort,
    private readonly log: Logger
  ) {}

  runGraph(req: GraphRunRequest): GraphRunResult {
    const result = this.inner.runGraph(req);
    return {
      stream: this.wrapStreamWithBilling(result.stream, req),
      final: result.final,
    };
  }

  private async *wrapStreamWithBilling(
    upstream: AsyncIterable<AiEvent>,
    req: GraphRunRequest
  ): AsyncIterable<AiEvent> {
    for await (const event of upstream) {
      if (event.type === "usage_report") {
        this.validateUsageFact(event.fact, req.runId, req.ingressRequestId);
        continue; // Don't yield usage_report to consumer
      }
      yield event;
    }
  }

  /**
   * Validate a UsageFact from a usage_report event.
   *
   * Per USAGE_FACT_VALIDATED: validates at ingestion boundary.
   * - Billing-authoritative (inproc/sandbox): strict schema, hard failure on invalid
   * - External (langgraph_server/claude_sdk): hints schema, soft skip on invalid
   */
  private validateUsageFact(
    fact: UsageFact,
    runId: string,
    ingressRequestId: string
  ): void {
    const isBillingAuthoritative =
      fact.executorType === "inproc" || fact.executorType === "sandbox";

    const schema = isBillingAuthoritative
      ? UsageFactStrictSchema
      : UsageFactHintsSchema;

    const validationResult = schema.safeParse(fact);

    if (!validationResult.success) {
      const errors = validationResult.error.format();

      if (isBillingAuthoritative) {
        this.log.error(
          {
            runId,
            ingressRequestId,
            executorType: fact.executorType,
            validationErrors: errors,
            fact,
          },
          "CRITICAL: Invalid UsageFact from billing-authoritative executor - validation failed"
        );
        throw new Error(
          `Billing validation failed: invalid UsageFact from ${fact.executorType} (missing usageUnitId or malformed fields)`
        );
      } else {
        this.log.warn(
          {
            runId,
            ingressRequestId,
            executorType: fact.executorType,
            validationErrors: errors,
            fact,
          },
          "External executor emitted invalid UsageFact (telemetry hint only, not authoritative)"
        );
      }
    }
  }
}
