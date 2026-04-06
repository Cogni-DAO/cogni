// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/graph-execution-host/decorators/billing-enrichment`
 * Purpose: Decorator that enriches neutral usage_report events with billing identity.
 * Scope: Adds billingAccountId and virtualKeyId in the per-run wrapper layer before billing validation. Does not validate or persist.
 * Invariants:
 *   - BILLING_IDENTITY_OUTSIDE_INNER_EXECUTOR: inner providers emit neutral usage facts
 *   - NO_LAUNCHER_WRAPPERS: bootstrap composes this decorator per run
 *   - PURE_LIBRARY: no env vars, no process lifecycle
 * Side-effects: none
 * Links: usage-commit.decorator.ts, graph-executor.factory.ts
 * @public
 */

import type { AiEvent, UsageReportEvent } from "@cogni/ai-core";
import type {
  ExecutionContext,
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
} from "@cogni/graph-execution-core";

import type { BillingIdentity } from "../ports/billing-identity";

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
