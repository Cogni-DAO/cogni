// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/billing-enrichment.decorator`
 * Purpose: Decorator that enriches neutral usage_report events with billing identity.
 * Scope: Adds billingAccountId and virtualKeyId in the per-run wrapper layer before billing validation. Does not validate or persist.
 * Invariants:
 *   - BILLING_IDENTITY_OUTSIDE_INNER_EXECUTOR: inner providers emit neutral usage facts
 *   - NO_LAUNCHER_WRAPPERS: bootstrap composes this decorator per run
 * Side-effects: none
 * Links: graph-executor.factory.ts, billing-executor.decorator.ts
 * @public
 */

import type {
  ExecutionContext,
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
} from "@/ports";
import type { AiEvent, UsageReportEvent } from "@/types/ai-events";

export interface BillingIdentity {
  readonly billingAccountId: string;
  readonly virtualKeyId: string;
}

/**
 * Enrich usage_report facts with canonical billing identity in the wrapper layer.
 */
export class BillingEnrichmentGraphExecutorDecorator
  implements GraphExecutorPort
{
  constructor(
    private readonly inner: GraphExecutorPort,
    private readonly billing: BillingIdentity
  ) {}

  runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
    const result = this.inner.runGraph(req, ctx);
    return {
      stream: this.enrichStream(result.stream),
      final: result.final,
    };
  }

  private async *enrichStream(
    upstream: AsyncIterable<AiEvent>
  ): AsyncIterable<AiEvent> {
    for await (const event of upstream) {
      if (event.type !== "usage_report") {
        yield event;
        continue;
      }

      const enriched: UsageReportEvent = {
        type: "usage_report",
        fact: {
          ...event.fact,
          billingAccountId: this.billing.billingAccountId,
          virtualKeyId: this.billing.virtualKeyId,
        },
      };
      yield enriched;
    }
  }
}
