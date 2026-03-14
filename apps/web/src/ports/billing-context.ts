// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/billing-context`
 * Purpose: App-layer billing resolution for graph execution.
 * Scope: Defines BillingContext and BillingResolver for adapters/decorators that need billing credentials. Does not appear on any shared contract.
 * Invariants:
 *   - APP_LAYER_ONLY: These types never appear in @cogni/graph-execution-core
 *   - RESOLVER_AT_CONSTRUCTION: BillingResolver is injected at factory construction, resolved per-run from actorUserId
 * Side-effects: none (interface only)
 * Links: docs/spec/unified-graph-launch.md
 * @public
 */

/** Billing credentials resolved per-run for adapters and decorators. */
export interface BillingContext {
  readonly billingAccountId: string;
  readonly virtualKeyId: string;
}

/**
 * Resolves billing credentials from actor identity.
 * Injected at factory construction time (static dep).
 * Called per-run with actorUserId from ExecutionContext.
 */
export interface BillingResolver {
  resolve(actorUserId: string): BillingContext;
}
