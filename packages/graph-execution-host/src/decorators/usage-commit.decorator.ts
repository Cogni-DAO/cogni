// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/graph-execution-host/decorators/usage-commit`
 * Purpose: Decorator that wraps GraphExecutorPort with billing validation and usage receipt writing.
 * Scope: Intercepts usage_report events from the stream, validates via Zod schemas. Does not write platform (LiteLLM) receipts directly — defers those to the LiteLLM callback.
 * Invariants:
 *   - CALLBACK_WRITES_PLATFORM_RECEIPTS: LiteLLM callback writes receipts for platform runs. BYO receipts written directly here.
 *   - BILLING_INDEPENDENT_OF_CLIENT: validation fires during stream iteration, not on client connection
 *   - USAGE_FACT_VALIDATED: Zod validation at ingestion boundary (strict for inproc/sandbox, hints for external)
 *   - ONE_LEDGER_WRITER: commitUsageFact() remains the sole caller of recordChargeReceipt()
 *   - PURE_LIBRARY: no env vars, no process lifecycle
 * Side-effects: IO (DB write for non-platform usage receipts via commitUsageFact)
 * Links: observability-executor.decorator.ts, billing callback route
 * @public
 */

import {
  type AiEvent,
  type UsageFact,
  UsageFactHintsSchema,
  UsageFactStrictSchema,
} from "@cogni/ai-core";
import type {
  ExecutionContext,
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
} from "@cogni/graph-execution-core";

import type { CommitUsageFactFn } from "../ports/commit-usage-fact";
import type { LoggerPort } from "../ports/logger.port";

/**
 * Decorator that wraps GraphExecutorPort with billing validation and usage commit.
 *
 * Intercepts `usage_report` events from the upstream stream and validates the
 * UsageFact via Zod (strict for billing-authoritative executors, hints for
 * external).
 *
 * `usage_report` events are consumed by the decorator and NOT yielded to
 * the downstream consumer — billing events are invisible to callers.
 *
 * For non-platform sources (codex, ollama): commits receipts directly via
 * commitUsageFact() since no LiteLLM callback exists for these providers.
 * For platform sources (litellm): defers to the LiteLLM callback
 * (CALLBACK_WRITES_PLATFORM_RECEIPTS).
 *
 * Caller MUST consume `stream` to completion for validation/commit side-effects to fire.
 */
export class UsageCommitDecorator implements GraphExecutorPort {
  constructor(
    private readonly inner: GraphExecutorPort,
    private readonly log: LoggerPort,
    private readonly commitByo: CommitUsageFactFn
  ) {}

  runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
    const result = this.inner.runGraph(req, ctx);
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
        this.validateUsageFact(event.fact, req.runId);
        // For non-platform sources, commit receipt directly (no LiteLLM callback).
        // BILLING_NEVER_THROWS: commitUsageFact catches all errors internally.
        if (event.fact.source !== "litellm") {
          await this.commitByo(event.fact, this.log);
        }
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
  private validateUsageFact(fact: UsageFact, runId: string): void {
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
