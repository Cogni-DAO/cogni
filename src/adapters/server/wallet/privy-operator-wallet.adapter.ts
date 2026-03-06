// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/wallet/privy-operator-wallet`
 * Purpose: Privy-managed operator wallet adapter — submits typed intents to Privy HSM for signing.
 * Scope: Implements OperatorWalletPort via @privy-io/server-auth SDK. Does not hold raw key material — Privy HSM signs transactions.
 * Invariants: KEY_NEVER_IN_APP, ADDRESS_VERIFIED_AT_STARTUP (lazy on first use), NO_GENERIC_SIGNING, PRIVY_SIGNED_REQUESTS.
 * Side-effects: IO (Privy API calls for wallet verification and tx submission)
 * Links: docs/spec/operator-wallet.md
 * @public
 */

import { PrivyClient } from "@privy-io/server-auth";

import type { OperatorWalletPort, TransferIntent } from "@/ports";

export interface PrivyOperatorWalletConfig {
  /** Privy application ID */
  appId: string;
  /** Privy application secret */
  appSecret: string;
  /** Privy signing key for signed requests */
  signingKey: string;
  /** Expected operator wallet address from repo-spec (checksummed) */
  expectedAddress: string;
  /** Split contract address from repo-spec */
  splitAddress: string;
}

/**
 * Privy-managed operator wallet adapter.
 * Verifies wallet address against repo-spec on first use (lazy verification).
 * Submits typed intents to Privy HSM — no raw key material in process.
 */
export class PrivyOperatorWalletAdapter implements OperatorWalletPort {
  private readonly client: PrivyClient;
  private readonly expectedAddress: string;
  private readonly splitAddress: string;
  private verified = false;
  private walletId: string | undefined;

  constructor(config: PrivyOperatorWalletConfig) {
    this.client = new PrivyClient(config.appId, config.appSecret, {
      walletApi: {
        authorizationPrivateKey: config.signingKey,
      },
    });
    this.expectedAddress = config.expectedAddress;
    this.splitAddress = config.splitAddress;
  }

  /**
   * Verify that Privy reports a wallet matching the expected address from repo-spec.
   * Called lazily on first use. Throws on mismatch (ADDRESS_VERIFIED_AT_STARTUP).
   */
  private async verify(): Promise<void> {
    if (this.verified) return;

    // List all wallets managed by this Privy app
    const wallets = await this.client.walletApi.getWallets();

    // Find the wallet matching our expected address
    const match = wallets.data.find(
      (w) => w.address.toLowerCase() === this.expectedAddress.toLowerCase()
    );

    if (!match) {
      throw new Error(
        `[OperatorWallet] ADDRESS_VERIFIED_AT_STARTUP failed: Privy has no wallet matching ` +
          `repo-spec address ${this.expectedAddress}. Run scripts/provision-operator-wallet.ts first.`
      );
    }

    this.walletId = match.id;
    this.verified = true;
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

    const result = await this.client.walletApi.ethereum.sendTransaction({
      walletId: this.getWalletId(),
      caip2: "eip155:8453",
      transaction: {
        to: this.splitAddress as `0x${string}`,
        data: encodeSplitDistribute(this.splitAddress, token),
        value: 0,
      },
    });

    return result.hash;
  }

  async fundOpenRouterTopUp(intent: TransferIntent): Promise<string> {
    await this.verify();

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
    if (intent.metadata.chain_id !== 8453) {
      throw new Error(
        `[OperatorWallet] Chain mismatch: intent chain_id ${intent.metadata.chain_id} ` +
          `does not match expected chain 8453 (Base)`
      );
    }

    // Submit transaction via Privy (Privy handles signing + broadcast)
    const result = await this.client.walletApi.ethereum.sendTransaction({
      walletId: this.getWalletId(),
      caip2: `eip155:${intent.metadata.chain_id}`,
      transaction: {
        to: intent.metadata.contract_address as `0x${string}`,
        data: intent.calldata as `0x${string}`,
        value: intent.call_value as `0x${string}`,
      },
    });

    return result.hash;
  }
}

/**
 * Encode a minimal distributeERC20 call for the Split contract.
 * This is a simplified encoding — the Split SDK would be used in production
 * for proper ABI encoding with recipient arrays.
 */
function encodeSplitDistribute(
  splitAddress: string,
  token: string
): `0x${string}` {
  // distributeERC20(address split, address token, address[] accounts, uint32[] percentAllocations, uint32 distributorFee, address distributorAddress)
  // Function selector: 0x5db8... (keccak256 of the full signature)
  // For MVP, we use the 0xSplits SDK's distributeERC20 which only needs split + token
  // The contract reads recipients/percentages from its own storage
  const fnSelector = "0xc9a6ce04"; // distributeERC20(address,address)
  const paddedSplit = splitAddress.slice(2).toLowerCase().padStart(64, "0");
  const paddedToken = token.slice(2).toLowerCase().padStart(64, "0");
  return `${fnSelector}${paddedSplit}${paddedToken}` as `0x${string}`;
}
