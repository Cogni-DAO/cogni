// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/copy-trade/target-source`
 * Purpose: Verifies the env-backed `CopyTradeTargetSource` + the server-env parser
 *          for `COPY_TRADE_TARGET_WALLETS` (comma-separated list).
 * Scope: Unit. No DB, no HTTP. Just the port impl + the Zod preprocessing.
 * @public
 */

import type { ActorId } from "@cogni/ids";
import {
  COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  COGNI_SYSTEM_PRINCIPAL_USER_ID,
} from "@cogni/node-shared";
import { BASE_VALID_ENV } from "@tests/_fixtures/env/base-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  envTargetSource,
  type WalletAddress,
} from "@/features/copy-trade/target-source";

const W1 = "0xAAAAbbbbAAAAbbbbAAAAbbbbAAAAbbbbAAAAbbbb" as WalletAddress;
const W2 = "0xCCCCddddCCCCddddCCCCddddCCCCddddCCCCdddd" as WalletAddress;
const ANY_ACTOR = "00000000-0000-4000-a000-000000000001" as unknown as ActorId;

describe("envTargetSource", () => {
  it("listForActor returns empty list for empty input", async () => {
    const src = envTargetSource([]);
    await expect(src.listForActor(ANY_ACTOR)).resolves.toEqual([]);
  });

  it("listForActor preserves caller order", async () => {
    const src = envTargetSource([W1, W2]);
    await expect(src.listForActor(ANY_ACTOR)).resolves.toEqual([W1, W2]);
  });

  it("listForActor result is frozen — push throws", async () => {
    const src = envTargetSource([W1, W2]);
    const first = (await src.listForActor(ANY_ACTOR)) as WalletAddress[];
    expect(() => first.push(W1)).toThrow();
    const second = await src.listForActor(ANY_ACTOR);
    expect(second).toEqual([W1, W2]);
  });

  it("listAllActive attributes every wallet to the system tenant", async () => {
    const src = envTargetSource([W1, W2]);
    const enumerated = await src.listAllActive();
    expect(enumerated).toEqual([
      {
        billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
        createdByUserId: COGNI_SYSTEM_PRINCIPAL_USER_ID,
        targetWallet: W1,
      },
      {
        billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
        createdByUserId: COGNI_SYSTEM_PRINCIPAL_USER_ID,
        targetWallet: W2,
      },
    ]);
  });
});

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("serverEnv.COPY_TRADE_TARGET_WALLETS parsing", () => {
  it("defaults to [] when unset", async () => {
    process.env = { ...BASE_VALID_ENV };
    delete process.env.COPY_TRADE_TARGET_WALLETS;
    const { serverEnv } = await import("@/shared/env/server-env");
    expect(serverEnv().COPY_TRADE_TARGET_WALLETS).toEqual([]);
  });

  it("parses empty string as []", async () => {
    process.env = { ...BASE_VALID_ENV, COPY_TRADE_TARGET_WALLETS: "" };
    const { serverEnv } = await import("@/shared/env/server-env");
    expect(serverEnv().COPY_TRADE_TARGET_WALLETS).toEqual([]);
  });

  it("parses a single address", async () => {
    process.env = { ...BASE_VALID_ENV, COPY_TRADE_TARGET_WALLETS: W1 };
    const { serverEnv } = await import("@/shared/env/server-env");
    expect(serverEnv().COPY_TRADE_TARGET_WALLETS).toEqual([W1]);
  });

  it("parses comma-separated list with whitespace", async () => {
    process.env = {
      ...BASE_VALID_ENV,
      COPY_TRADE_TARGET_WALLETS: ` ${W1} , ${W2} `,
    };
    const { serverEnv } = await import("@/shared/env/server-env");
    expect(serverEnv().COPY_TRADE_TARGET_WALLETS).toEqual([W1, W2]);
  });

  it("rejects a malformed address", async () => {
    process.env = {
      ...BASE_VALID_ENV,
      COPY_TRADE_TARGET_WALLETS: `${W1},0xnot-hex`,
    };
    const { serverEnv, EnvValidationError } = await import(
      "@/shared/env/server-env"
    );
    expect(() => serverEnv()).toThrow(EnvValidationError);
  });
});
