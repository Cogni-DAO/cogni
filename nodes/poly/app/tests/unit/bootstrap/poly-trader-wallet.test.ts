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
      geoBlockToken: "geo-token",
      deriveCreds,
    });

    await expect(factory.derive(SIGNER)).resolves.toEqual({
      key: "key",
      secret: "secret",
      passphrase: "passphrase",
    });

    expect(deriveCreds).toHaveBeenCalledWith({
      signer: SIGNER,
      polygonRpcUrl: "https://polygon.example",
      geoBlockToken: "geo-token",
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

    await expect(factory.derive(SIGNER)).rejects.toThrow(
      "Failed to derive Polymarket CLOB API credentials for the tenant wallet"
    );
  });

  it("rejects empty CLOB credential responses instead of storing them", async () => {
    const deriveCreds = vi.fn().mockResolvedValue({});
    const factory = createRealClobCredsFactory({
      logger: makeNoopLogger(),
      deriveCreds,
    });

    await expect(factory.derive(SIGNER)).rejects.toThrow(
      "Failed to derive Polymarket CLOB API credentials for the tenant wallet"
    );
  });

  it("rotates live creds through the bootstrap CLOB seam", async () => {
    const rotateCreds = vi.fn().mockResolvedValue({
      key: "new-key",
      secret: "new-secret",
      passphrase: "new-passphrase",
    });
    const factory = createRealClobCredsFactory({
      logger: makeNoopLogger(),
      polygonRpcUrl: "https://polygon.example",
      rotateCreds,
    });
    const currentCreds = {
      key: "old-key",
      secret: "old-secret",
      passphrase: "old-passphrase",
    };

    await expect(factory.rotate(SIGNER, currentCreds)).resolves.toEqual({
      key: "new-key",
      secret: "new-secret",
      passphrase: "new-passphrase",
    });

    expect(rotateCreds).toHaveBeenCalledWith({
      signer: SIGNER,
      currentCreds,
      polygonRpcUrl: "https://polygon.example",
    });
  });

  it("rejects empty rotation responses instead of overwriting stored creds", async () => {
    const rotateCreds = vi.fn().mockResolvedValue({});
    const factory = createRealClobCredsFactory({
      logger: makeNoopLogger(),
      rotateCreds,
    });

    await expect(
      factory.rotate(SIGNER, {
        key: "old-key",
        secret: "old-secret",
        passphrase: "old-passphrase",
      })
    ).rejects.toThrow(
      "Failed to rotate Polymarket CLOB API credentials for the tenant wallet"
    );
  });
});
