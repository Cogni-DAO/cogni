// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/financial-ledger/tests/domain`
 * Purpose: Unit tests for financial-ledger domain constants and conversion utilities.
 * Scope: Tests domain logic only. Does not test adapters or require external services.
 * Invariants: All tests are pure (no I/O, no side effects).
 * Side-effects: none
 * Links: packages/financial-ledger/src/domain
 * @internal
 */

import {
  ACCOUNT,
  ACCOUNT_CODE,
  ACCOUNT_DEFINITIONS,
  CREDITS_PER_USD,
  LEDGER,
  microUsdcToCredits,
  uuidToBigInt,
} from "@cogni/financial-ledger";
import { describe, expect, it } from "vitest";

describe("domain/conversion", () => {
  describe("microUsdcToCredits", () => {
    it("converts 1 USDC (1_000_000 micro) to 10_000_000 credits", () => {
      expect(microUsdcToCredits(1_000_000n)).toBe(10_000_000n);
    });

    it("converts 0.01 USDC (10_000 micro) to 100_000 credits", () => {
      expect(microUsdcToCredits(10_000n)).toBe(100_000n);
    });

    it("converts 0 to 0", () => {
      expect(microUsdcToCredits(0n)).toBe(0n);
    });

    it("matches CREDITS_PER_USD for 1 USD", () => {
      expect(microUsdcToCredits(1_000_000n)).toBe(CREDITS_PER_USD);
    });

    it("is pure integer math (no precision loss)", () => {
      expect(microUsdcToCredits(1n)).toBe(10n);
    });
  });

  describe("uuidToBigInt", () => {
    it("converts a UUID to a bigint", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = uuidToBigInt(uuid);
      expect(result).toBe(BigInt("0x550e8400e29b41d4a716446655440000"));
    });

    it("handles different UUIDs", () => {
      const a = uuidToBigInt("00000000-0000-0000-0000-000000000001");
      const b = uuidToBigInt("00000000-0000-0000-0000-000000000002");
      expect(a).toBe(1n);
      expect(b).toBe(2n);
    });

    it("round-trips with known values", () => {
      const uuid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      const result = uuidToBigInt(uuid);
      expect(result).toBe(BigInt("0xffffffffffffffffffffffffffffffff"));
    });
  });
});

describe("domain/accounts", () => {
  it("has exactly 6 MVP accounts (5 base + ProviderFloat)", () => {
    expect(ACCOUNT_DEFINITIONS).toHaveLength(6);
  });

  it("all account IDs are unique", () => {
    const ids = ACCOUNT_DEFINITIONS.map((def) => def.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("all account definitions have valid ledger IDs", () => {
    const validLedgers = new Set(Object.values(LEDGER));
    for (const def of ACCOUNT_DEFINITIONS) {
      expect(validLedgers.has(def.ledger)).toBe(true);
    }
  });

  it("all account definitions have valid codes", () => {
    const validCodes = new Set(Object.values(ACCOUNT_CODE));
    for (const def of ACCOUNT_DEFINITIONS) {
      expect(validCodes.has(def.code)).toBe(true);
    }
  });

  it("ACCOUNT constants match ACCOUNT_DEFINITIONS", () => {
    const definedIds = new Set(ACCOUNT_DEFINITIONS.map((d) => d.id));
    for (const id of Object.values(ACCOUNT)) {
      expect(definedIds.has(id)).toBe(true);
    }
  });

  it("uses only USDC and CREDIT ledgers", () => {
    const ledgers = new Set(ACCOUNT_DEFINITIONS.map((d) => d.ledger));
    expect(ledgers).toEqual(new Set([LEDGER.USDC, LEDGER.CREDIT]));
  });
});
