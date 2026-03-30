// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/ports`
 * Purpose: Barrel export for all port interfaces.
 * Scope: Re-exports only. Does not define any interfaces.
 * Invariants: Must re-export every port interface.
 * Side-effects: none
 * Links: docs/spec/broadcasting.md
 * @public
 */

export type {
  BroadcastLedgerUserPort,
  BroadcastLedgerWorkerPort,
  ContentMessageFilter,
} from "./broadcast-ledger.port";
export type {
  ContentOptimizerPort,
  PlatformPostDraft,
} from "./content-optimizer.port";
export type {
  HealthCheckResult,
  PublishPort,
  PublishResult,
} from "./publish.port";
