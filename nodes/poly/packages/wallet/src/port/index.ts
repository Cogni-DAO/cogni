// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-wallet/port`
 * Purpose: Re-exports the PolyTraderWalletPort interface + types from one place.
 * Scope: Type re-exports only. Does not contain runtime code or export any adapter.
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
  WrapIdleUsdcEResult,
} from "./poly-trader-wallet.port";
