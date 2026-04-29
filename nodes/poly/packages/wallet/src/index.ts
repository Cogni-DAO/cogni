// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-wallet`
 * Purpose: Re-exports the PolyTraderWalletPort interface + types. Adapters are
 *   accessed via subpath imports (`@cogni/poly-wallet/adapters/privy`) so
 *   consumers opt into vendor deps only when wiring an adapter.
 * Scope: Type + interface re-exports only. Does not export adapter implementations or expose runtime.
 * Invariants: none (barrel file).
 * Side-effects: none
 * Links: docs/spec/poly-trader-wallet-port.md
 * @public
 */

export type {
  AuthorizationFailure,
  AuthorizedSigningContext,
  AuthorizeIntentResult,
  CustodialConsent,
  EnableTradingPreflightError,
  OrderIntentSummary,
  PolyClobApiKeyCreds,
  PolyTraderSigningContext,
  PolyTraderWalletPort,
  TradingApprovalStep,
  TradingApprovalStepKind,
  TradingApprovalStepState,
  TradingApprovalsState,
} from "./port";
