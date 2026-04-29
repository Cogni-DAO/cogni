// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-node-contracts`
 * Purpose: Poly-node-scoped Zod contracts for HTTP/API request/response shapes.
 *          Carved out of `@cogni/node-contracts` so future poly contract changes
 *          stop tripping single-node-scope on the operator domain.
 * Scope: Poly node only. Cross-node contracts stay in `@cogni/node-contracts`.
 * Invariants: All contracts here are imported only by `nodes/poly/**`.
 * Side-effects: none
 * Links: docs/spec/node-ci-cd-contract.md (node-owned packages),
 *        work/items/task.0421.per-node-package-carveout-standard.md
 * @public
 */

export * from "./poly.copy-trade.orders.v1.contract";
export * from "./poly.copy-trade.targets.v1.contract";
export * from "./poly.research-report.v1.contract";
export * from "./poly.sync-health.v1.contract";
export * from "./poly.wallet.balance.v1.contract";
export * from "./poly.wallet.balances.v1.contract";
export * from "./poly.wallet.connection.v1.contract";
export * from "./poly.wallet.enable-trading.v1.contract";
export * from "./poly.wallet.execution.v1.contract";
export * from "./poly.wallet.grants.v1.contract";
export * from "./poly.wallet.overview.v1.contract";
export * from "./poly.wallet.position-actions.v1.contract";
export * from "./poly.wallet-analysis.v1.contract";
