// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/wallet/privy-operator-wallet`
 * Purpose: Privy-managed operator wallet adapter — submits typed intents to Privy HSM for signing.
 * Scope: Implements OperatorWalletPort via @privy-io/node SDK. Does not hold raw key material — Privy HSM signs transactions.
 * Invariants: KEY_NEVER_IN_APP, ADDRESS_VERIFIED_AT_STARTUP (lazy on first use), NO_GENERIC_SIGNING, PRIVY_SIGNED_REQUESTS, DESTINATION_ALLOWLIST.
 * Side-effects: IO (Privy API calls for wallet verification and tx submission)
 * Links: docs/spec/operator-wallet.md
 * @public
 */

import type { AuthorizationContext } from "@privy-io/node";
import { PrivyClient } from "@privy-io/node";

import type { OperatorWalletPort, TransferIntent } from "@/ports";

/** Base chain ID — hardcoded per spec (chain-specific adapter). */
const BASE_CHAIN_ID = 8453;
const BASE_CAIP2 = `eip155:${BASE_CHAIN_ID}`;

/** Default per-tx cap in USD (wei-denominated USDC has 6 decimals). */
const DEFAULT_MAX_TOPUP_USD = 500;

/**
 * Coinbase Transfers contract on Base.
 * This is the only contract allowed for fundOpenRouterTopUp (DESTINATION_ALLOWLIST).
 */
const COINBASE_TRANSFERS_BASE = "0x0000000000000000000000000000000000000000"; // placeholder — set during provisioning

export interface PrivyOperatorWalletConfig {
  /** Privy application ID */
  appId: string;
  /** Privy application secret */
  appSecret: string;
  /** Privy signing key for signed requests (base64-encoded PKCS8) */
  signingKey: string;
  /** Expected operator wallet address from repo-spec (checksummed) */
  expectedAddress: string;
  /** Split contract address from repo-spec */
  splitAddress: string;
  /** Per-tx cap in USD for OpenRouter top-ups (default: 500) */
  maxTopUpUsd?: number;
  /** Allowed contract addresses for fundOpenRouterTopUp (DESTINATION_ALLOWLIST) */
  allowedTopUpContracts?: string[];
}

/**
 * Privy-managed operator wallet adapter.
 * Verifies wallet address against repo-spec on first use (lazy verification).
 * Submits typed intents to Privy HSM — no raw key material in process.
 */
export class PrivyOperatorWalletAdapter implements OperatorWalletPort {
  private readonly client: PrivyClient;
  private readonly authContext: AuthorizationContext;
  private readonly expectedAddress: string;
  private readonly splitAddress: string;
  private readonly maxTopUpUsd: number;
  private readonly allowedTopUpContracts: Set<string>;
  private verifyPromise: Promise<void> | undefined;
  private walletId: string | undefined;

  constructor(config: PrivyOperatorWalletConfig) {
    this.client = new PrivyClient({
      appId: config.appId,
      appSecret: config.appSecret,
    });
    this.authContext = {
      authorization_private_keys: [config.signingKey],
    };
    this.expectedAddress = config.expectedAddress;
    this.splitAddress = config.splitAddress;
    this.maxTopUpUsd = config.maxTopUpUsd ?? DEFAULT_MAX_TOPUP_USD;
    // DESTINATION_ALLOWLIST: only the Split contract and explicitly allowed top-up contracts
    this.allowedTopUpContracts = new Set(
      (config.allowedTopUpContracts ?? [COINBASE_TRANSFERS_BASE]).map((a) =>
        a.toLowerCase()
      )
    );
  }

  /**
   * Verify that Privy reports a wallet matching the expected address from repo-spec.
   * Called lazily on first use. Throws on mismatch (ADDRESS_VERIFIED_AT_STARTUP).
   * Uses a promise lock to prevent redundant concurrent API calls.
   */
  private async verify(): Promise<void> {
    if (this.walletId) return;
    if (this.verifyPromise) return this.verifyPromise;

    this.verifyPromise = this.doVerify();
    return this.verifyPromise;
  }

  private async doVerify(): Promise<void> {
    // Paginate through all wallets to find the matching one
    let found = false;
    for await (const wallet of this.client.wallets().list()) {
      if (wallet.address.toLowerCase() === this.expectedAddress.toLowerCase()) {
        this.walletId = wallet.id;
        found = true;
        break;
      }
    }

    if (!found) {
      this.verifyPromise = undefined; // Allow retry
      throw new Error(
        `[OperatorWallet] ADDRESS_VERIFIED_AT_STARTUP failed: Privy has no wallet matching ` +
          `repo-spec address ${this.expectedAddress}. Run scripts/provision-operator-wallet.ts first.`
      );
    }
  }

  /** Returns walletId after verification — guaranteed non-null after verify(). */
  private getWalletId(): string {
    if (!this.walletId) {
      throw new Error(
        "[OperatorWallet] walletId not set — call verify() first"
      );
    }
    return this.walletId;
  }

  async getAddress(): Promise<string> {
    await this.verify();
    return this.expectedAddress;
  }

  getSplitAddress(): string {
    return this.splitAddress;
  }

  async distributeSplit(token: string): Promise<string> {
    await this.verify();

    const result = await this.client
      .wallets()
      .ethereum()
      .sendTransaction(this.getWalletId(), {
        caip2: BASE_CAIP2,
        params: {
          transaction: {
            to: this.splitAddress,
            data: encodeSplitDistribute(this.splitAddress, token),
            value: 0,
          },
        },
        authorization_context: this.authContext,
      });

    return result.hash;
  }

  async fundOpenRouterTopUp(intent: TransferIntent): Promise<string> {
    await this.verify();

    // DESTINATION_ALLOWLIST: reject transactions to non-allowlisted contracts
    if (
      !this.allowedTopUpContracts.has(
        intent.metadata.contract_address.toLowerCase()
      )
    ) {
      throw new Error(
        `[OperatorWallet] DESTINATION_ALLOWLIST: contract ${intent.metadata.contract_address} ` +
          `is not in the allowed top-up contracts list`
      );
    }

    // Validate sender matches operator wallet
    if (
      intent.metadata.sender.toLowerCase() !==
      this.expectedAddress.toLowerCase()
    ) {
      throw new Error(
        `[OperatorWallet] Sender mismatch: intent sender ${intent.metadata.sender} ` +
          `does not match operator wallet ${this.expectedAddress}`
      );
    }

    // Validate chain_id matches Base
    if (intent.metadata.chain_id !== BASE_CHAIN_ID) {
      throw new Error(
        `[OperatorWallet] Chain mismatch: intent chain_id ${intent.metadata.chain_id} ` +
          `does not match expected chain ${BASE_CHAIN_ID} (Base)`
      );
    }

    // OPERATOR_MAX_TOPUP_USD cap: reject if call_value exceeds cap
    // call_value is in wei; for USDC (6 decimals) $500 = 500_000_000
    const valueNum = BigInt(intent.call_value);
    const capWei = BigInt(this.maxTopUpUsd) * 1_000_000n; // USDC has 6 decimals
    if (valueNum > capWei) {
      throw new Error(
        `[OperatorWallet] OPERATOR_MAX_TOPUP_USD exceeded: value ${intent.call_value} ` +
          `exceeds cap of $${this.maxTopUpUsd} (${capWei.toString()} USDC wei)`
      );
    }

    // Submit transaction via Privy (Privy handles signing + broadcast)
    const result = await this.client
      .wallets()
      .ethereum()
      .sendTransaction(this.getWalletId(), {
        caip2: BASE_CAIP2,
        params: {
          transaction: {
            to: intent.metadata.contract_address,
            data: intent.calldata,
            value: intent.call_value,
          },
        },
        authorization_context: this.authContext,
      });

    return result.hash;
  }
}

/**
 * Encode a distributeERC20(address,address) call for the SplitMain contract.
 * Uses viem-compatible ABI encoding: 4-byte selector + abi-encoded args.
 *
 * keccak256("distributeERC20(address,address)") = 0xd1a06cf8...
 */
function encodeSplitDistribute(splitAddress: string, token: string): string {
  const fnSelector = "0xd1a06cf8"; // keccak256("distributeERC20(address,address)")
  const paddedSplit = splitAddress.slice(2).toLowerCase().padStart(64, "0");
  const paddedToken = token.slice(2).toLowerCase().padStart(64, "0");
  return `${fnSelector}${paddedSplit}${paddedToken}`;
}
