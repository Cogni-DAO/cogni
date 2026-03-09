// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/wallet/privy-operator-wallet`
 * Purpose: Privy-managed operator wallet adapter — submits typed intents to Privy HSM for signing.
 * Scope: Implements OperatorWalletPort via @privy-io/node SDK. Does not hold raw key material — Privy HSM signs transactions.
 * Invariants: KEY_NEVER_IN_APP, ADDRESS_VERIFIED_AT_STARTUP (lazy on first use), NO_GENERIC_SIGNING, PRIVY_SIGNED_REQUESTS.
 * Side-effects: IO (Privy API calls for wallet verification and tx submission)
 * Links: docs/spec/operator-wallet.md
 * @public
 */

import { PrivyClient } from "@privy-io/node";

import type { OperatorWalletPort, TransferIntent } from "@/ports";

export interface PrivyOperatorWalletConfig {
  /** Privy application ID */
  appId: string;
  /** Privy application secret */
  appSecret: string;
  /** Privy signing key for signed requests (base64-encoded PKCS8) — used by task.0085/task.0086 */
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
  private verifyPromise: Promise<void> | undefined;
  private walletId: string | undefined;

  constructor(config: PrivyOperatorWalletConfig) {
    this.client = new PrivyClient({
      appId: config.appId,
      appSecret: config.appSecret,
    });
    // signingKey stored in config for PRIVY_SIGNED_REQUESTS — used by task.0085/task.0086
    // when distributeSplit() and fundOpenRouterTopUp() are implemented
    this.expectedAddress = config.expectedAddress;
    this.splitAddress = config.splitAddress;
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

  async getAddress(): Promise<string> {
    await this.verify();
    return this.expectedAddress;
  }

  getSplitAddress(): string {
    return this.splitAddress;
  }

  async distributeSplit(_token: string): Promise<string> {
    throw new Error("not implemented — see task.0085");
  }

  async fundOpenRouterTopUp(_intent: TransferIntent): Promise<string> {
    throw new Error("not implemented — see task.0086");
  }
}
