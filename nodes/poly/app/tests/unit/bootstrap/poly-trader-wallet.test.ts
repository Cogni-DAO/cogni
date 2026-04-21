// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import type { LocalAccount } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createRealClobCredsFactory } from "@/bootstrap/poly-trader-wallet";
import { makeNoopLogger } from "@/shared/observability/server";

const SIGNER = {
  address: "0x1111111111111111111111111111111111111111",
} as LocalAccount;

describe("createRealClobCredsFactory", () => {
  it("derives live creds through the bootstrap CLOB seam", async () => {
    const deriveCreds = vi.fn().mockResolvedValue({
      key: "key",
      secret: "secret",
      passphrase: "passphrase",
    });

    const factory = createRealClobCredsFactory({
      logger: makeNoopLogger(),
      polygonRpcUrl: "https://polygon.example",
      deriveCreds,
    });

    await expect(factory(SIGNER)).resolves.toEqual({
      key: "key",
      secret: "secret",
      passphrase: "passphrase",
    });

    expect(deriveCreds).toHaveBeenCalledWith({
      signer: SIGNER,
      polygonRpcUrl: "https://polygon.example",
    });
  });

  it("surfaces a stable error when live derivation fails", async () => {
    const deriveCreds = vi
      .fn()
      .mockRejectedValue(new Error("clob unavailable"));
    const factory = createRealClobCredsFactory({
      logger: makeNoopLogger(),
      deriveCreds,
    });

    await expect(factory(SIGNER)).rejects.toThrow(
      "Failed to derive Polymarket CLOB API credentials for the tenant wallet"
    );
  });
});
