// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/operator-wallet/tests/fund-topup-gates`
 * Purpose: Unit tests for fundOpenRouterTopUp validation gates — security boundary of the wallet.
 * Scope: Tests SENDER_MATCH, DESTINATION_ALLOWLIST, CHAIN_MISMATCH, MIN_TOPUP, MAX_TOPUP_CAP gates. Mocks Privy SDK — does not make real API calls.
 * Invariants: Per operator-wallet.md and web3-openrouter-payments.md signing gates.
 * Side-effects: none
 * Links: packages/operator-wallet/src/adapters/privy/privy-operator-wallet.adapter.ts
 * @internal
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TransferIntent } from "../src/port/operator-wallet.port.js";

// ---------------------------------------------------------------------------
// Mock Privy SDK — we only need verify() to succeed (find a matching wallet)
// ---------------------------------------------------------------------------

const OPERATOR_ADDRESS = "0xdCCa8D85603C2CC47dc6974a790dF846f8695056";
const FAKE_WALLET_ID = "wallet-123";
const FAKE_TX_HASH = "0x" + "ab".repeat(32);

const mockSendTransaction = vi.fn().mockResolvedValue({ hash: FAKE_TX_HASH });

class MockPrivyClient {
  wallets() {
    return {
      list: async function* () {
        yield { id: FAKE_WALLET_ID, address: OPERATOR_ADDRESS };
      },
      ethereum: () => ({
        sendTransaction: mockSendTransaction,
      }),
    };
  }
}

vi.mock("@privy-io/node", () => ({
  PrivyClient: MockPrivyClient,
}));

// Import after mock is set up
const { PrivyOperatorWalletAdapter } = await import(
  "../src/adapters/privy/privy-operator-wallet.adapter.js"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRANSFERS_CONTRACT = "0x03059433BCdB6144624cC2443159D9445C32b7a8";
const TREASURY_ADDRESS = "0xF61c3fafD4D34b4568e7a500d92b28Ac175e83C6";
const SPLIT_ADDRESS = "0xd92EEc51C471CcF76996f0163Fd3cB6A61798f9C";

function makeAdapter(overrides?: { maxTopUpUsd?: number }) {
  return new PrivyOperatorWalletAdapter({
    appId: "test-app",
    appSecret: "test-secret",
    signingKey: "test-key",
    expectedAddress: OPERATOR_ADDRESS,
    splitAddress: SPLIT_ADDRESS,
    treasuryAddress: TREASURY_ADDRESS,
    markupPpm: 2_000_000n,
    revenueSharePpm: 750_000n,
    maxTopUpUsd: overrides?.maxTopUpUsd ?? 500,
  });
}

function validIntent(overrides?: Partial<TransferIntent>): TransferIntent {
  return {
    metadata: {
      sender: OPERATOR_ADDRESS,
      contract_address: TRANSFERS_CONTRACT,
      chain_id: 8453,
      ...overrides?.metadata,
    },
    call_data: {
      recipient_amount: "2000000", // $2.00 USDC
      deadline: "1800000000",
      recipient: "0x4444444444444444444444444444444444444444",
      recipient_currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      refund_destination: OPERATOR_ADDRESS,
      fee_amount: "100000", // $0.10 fee
      id: "0x00000000000000000000000000000001",
      operator: "0x5555555555555555555555555555555555555555",
      signature: "0xdeadbeef",
      prefix: "0x",
      ...overrides?.call_data,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fundOpenRouterTopUp validation gates", () => {
  let adapter: InstanceType<typeof PrivyOperatorWalletAdapter>;

  beforeEach(() => {
    mockSendTransaction.mockClear();
    adapter = makeAdapter();
  });

  it("succeeds with a valid intent", async () => {
    const hash = await adapter.fundOpenRouterTopUp(validIntent());
    expect(hash).toBe(FAKE_TX_HASH);
    // Two Privy txs: approve + transferTokenPreApproved
    expect(mockSendTransaction).toHaveBeenCalledTimes(2);
  });

  describe("Gate 1: SENDER_MATCH", () => {
    it("rejects when sender does not match operator address", async () => {
      const intent = validIntent({
        metadata: {
          sender: "0x0000000000000000000000000000000000000bad",
          contract_address: TRANSFERS_CONTRACT,
          chain_id: 8453,
        },
      });
      await expect(adapter.fundOpenRouterTopUp(intent)).rejects.toThrow(
        "SENDER_MISMATCH"
      );
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });
  });

  describe("Gate 2: DESTINATION_ALLOWLIST", () => {
    it("rejects when contract is not in allowlist", async () => {
      const intent = validIntent({
        metadata: {
          sender: OPERATOR_ADDRESS,
          contract_address: "0x0000000000000000000000000000000000000bad",
          chain_id: 8453,
        },
      });
      await expect(adapter.fundOpenRouterTopUp(intent)).rejects.toThrow(
        "DESTINATION_ALLOWLIST"
      );
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });
  });

  describe("Gate 3: CHAIN_MISMATCH", () => {
    it("rejects when chain_id is not Base (8453)", async () => {
      const intent = validIntent({
        metadata: {
          sender: OPERATOR_ADDRESS,
          contract_address: TRANSFERS_CONTRACT,
          chain_id: 1, // Ethereum mainnet
        },
      });
      await expect(adapter.fundOpenRouterTopUp(intent)).rejects.toThrow(
        "CHAIN_MISMATCH"
      );
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });
  });

  describe("Gate 4: MIN_TOPUP", () => {
    it("rejects when total USDC is below $1.05 minimum", async () => {
      const intent = validIntent({
        call_data: {
          recipient_amount: "500000", // $0.50
          deadline: "1800000000",
          recipient: "0x4444444444444444444444444444444444444444",
          recipient_currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          refund_destination: OPERATOR_ADDRESS,
          fee_amount: "25000", // $0.025
          id: "0x00000000000000000000000000000001",
          operator: "0x5555555555555555555555555555555555555555",
          signature: "0xdeadbeef",
          prefix: "0x",
        },
      });
      await expect(adapter.fundOpenRouterTopUp(intent)).rejects.toThrow(
        "MIN_TOPUP"
      );
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });
  });

  describe("Gate 5: MAX_TOPUP_CAP", () => {
    it("rejects when total USDC exceeds cap", async () => {
      const adapter2 = makeAdapter({ maxTopUpUsd: 10 }); // $10 cap
      const intent = validIntent({
        call_data: {
          recipient_amount: "10000000", // $10.00
          deadline: "1800000000",
          recipient: "0x4444444444444444444444444444444444444444",
          recipient_currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          refund_destination: OPERATOR_ADDRESS,
          fee_amount: "500000", // $0.50 — total $10.50 > $10 cap
          id: "0x00000000000000000000000000000001",
          operator: "0x5555555555555555555555555555555555555555",
          signature: "0xdeadbeef",
          prefix: "0x",
        },
      });
      await expect(adapter2.fundOpenRouterTopUp(intent)).rejects.toThrow(
        "MAX_TOPUP_CAP"
      );
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });

    it("accepts when total USDC is exactly at cap", async () => {
      const adapter2 = makeAdapter({ maxTopUpUsd: 2 }); // $2 cap
      const intent = validIntent({
        call_data: {
          recipient_amount: "1900000", // $1.90
          deadline: "1800000000",
          recipient: "0x4444444444444444444444444444444444444444",
          recipient_currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          refund_destination: OPERATOR_ADDRESS,
          fee_amount: "100000", // $0.10 — total $2.00 === $2 cap
          id: "0x00000000000000000000000000000001",
          operator: "0x5555555555555555555555555555555555555555",
          signature: "0xdeadbeef",
          prefix: "0x",
        },
      });
      const hash = await adapter2.fundOpenRouterTopUp(intent);
      expect(hash).toBe(FAKE_TX_HASH);
    });
  });

  describe("deadline parsing", () => {
    it("handles ISO 8601 deadline strings", async () => {
      const intent = validIntent({
        call_data: {
          recipient_amount: "2000000",
          deadline: "2026-12-31T23:59:59Z",
          recipient: "0x4444444444444444444444444444444444444444",
          recipient_currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          refund_destination: OPERATOR_ADDRESS,
          fee_amount: "100000",
          id: "0x00000000000000000000000000000001",
          operator: "0x5555555555555555555555555555555555555555",
          signature: "0xdeadbeef",
          prefix: "0x",
        },
      });
      const hash = await adapter.fundOpenRouterTopUp(intent);
      expect(hash).toBe(FAKE_TX_HASH);
    });

    it("handles unix timestamp deadline strings", async () => {
      const intent = validIntent({
        call_data: {
          recipient_amount: "2000000",
          deadline: "1800000000",
          recipient: "0x4444444444444444444444444444444444444444",
          recipient_currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          refund_destination: OPERATOR_ADDRESS,
          fee_amount: "100000",
          id: "0x00000000000000000000000000000001",
          operator: "0x5555555555555555555555555555555555555555",
          signature: "0xdeadbeef",
          prefix: "0x",
        },
      });
      const hash = await adapter.fundOpenRouterTopUp(intent);
      expect(hash).toBe(FAKE_TX_HASH);
    });
  });
});
