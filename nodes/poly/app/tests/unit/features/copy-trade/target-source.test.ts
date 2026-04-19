// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/copy-trade/target-source`
 * Purpose: Verifies the env-backed `CopyTradeTargetSource` + the server-env parser
 *          for `COPY_TRADE_TARGET_WALLETS` (comma-separated list).
 * Scope: Unit. No DB, no HTTP. Just the port impl + the Zod preprocessing.
 * @public
 */

import { BASE_VALID_ENV } from "@tests/_fixtures/env/base-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  envTargetSource,
  type WalletAddress,
} from "@/features/copy-trade/target-source";

const W1 = "0xAAAAbbbbAAAAbbbbAAAAbbbbAAAAbbbbAAAAbbbb" as WalletAddress;
const W2 = "0xCCCCddddCCCCddddCCCCddddCCCCddddCCCCdddd" as WalletAddress;

describe("envTargetSource", () => {
  it("returns empty list for empty input", async () => {
    const src = envTargetSource([]);
    await expect(src.listTargets()).resolves.toEqual([]);
  });

  it("preserves caller order", async () => {
    const src = envTargetSource([W1, W2]);
    await expect(src.listTargets()).resolves.toEqual([W1, W2]);
  });

  it("is immutable — mutating the returned array does not affect subsequent calls", async () => {
    const src = envTargetSource([W1, W2]);
    const first = (await src.listTargets()) as WalletAddress[];
    expect(() => first.push(W1)).toThrow();
    const second = await src.listTargets();
    expect(second).toEqual([W1, W2]);
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
