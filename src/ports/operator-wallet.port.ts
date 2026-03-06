// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/operator-wallet`
 * Purpose: Operator wallet port — narrow, typed interface for outbound on-chain payments.
 * Scope: Defines the operator wallet interface and TransferIntent type. Does not implement custody logic or hold key material.
 * Invariants: NO_GENERIC_SIGNING — no signTransaction(calldata). KEY_NEVER_IN_APP — no raw key material.
 * Side-effects: none (interface definition only)
 * Links: docs/spec/operator-wallet.md
 * @public
 */

/**
 * TransferIntent from OpenRouter's /api/v1/credits/coinbase endpoint.
 * Describes the on-chain action needed to fund OpenRouter credits.
 */
export interface TransferIntent {
  metadata: {
    /** Sender address — must match operator wallet address */
    sender: string;
    /** Target contract address (Coinbase Transfers) */
    contract_address: string;
    /** Chain ID for the transaction */
    chain_id: number;
    /** Solidity function to call on the Transfers contract */
    function_name: string;
  };
  /** Call value in wei (for native ETH functions) */
  call_value: string;
  /** ABI-encoded calldata for the function */
  calldata: string;
}

/**
 * Operator wallet port — a bounded payments actuator, not a generic signer.
 * Each outbound transaction type gets a named method. No raw signing surface.
 */
export interface OperatorWalletPort {
  /** Return the operator wallet's public address (checksummed) */
  getAddress(): Promise<string>;

  /** Return the Split contract address (from repo-spec) */
  getSplitAddress(): string;

  /**
   * Trigger USDC distribution on the Split contract.
   * Sends operator share to this wallet, DAO share to treasury.
   *
   * @param token - ERC-20 token address (USDC)
   * @returns txHash on successful broadcast
   */
  distributeSplit(token: string): Promise<string>;

  /**
   * Fund OpenRouter credits via Coinbase Commerce protocol.
   * Encodes the appropriate Transfers function internally — caller cannot control calldata.
   *
   * @param intent - TransferIntent from OpenRouter's /api/v1/credits/coinbase
   * @returns txHash on successful broadcast
   * @throws if contract not allowlisted, sender mismatch, or value exceeds cap
   */
  fundOpenRouterTopUp(intent: TransferIntent): Promise<string>;
}
