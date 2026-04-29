// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: tests/unit/features/redeem/payout-redemption-decode
 * Purpose: Regression coverage for the subscriber + catchup `PayoutRedemption`
 *   decoding. v0 indexed `log.topics[4]` for the CTF event's conditionId — but
 *   conditionId is in `data`, not `topics`, on CTF (only 3 indexed args:
 *   redeemer, collateralToken, parentCollectionId). NegRiskAdapter has 2
 *   indexed args (redeemer, conditionId) and the right field IS in topics[2].
 *   The two shapes differ; relying on raw-topic indexing silently dropped
 *   every CTF redemption confirmation.
 *
 *   These tests pin the decode contract: viem's `decodeEventLog`, given the
 *   correct ABI, returns `args.conditionId` and `args.redeemer` regardless
 *   of whether the field lives in `data` or `topics`.
 * Scope: Pure logic — encodes synthetic logs with viem and round-trips them.
 *   No chain.
 * Links: src/features/redeem/redeem-subscriber.ts, src/features/redeem/redeem-catchup.ts, work/items/task.0388
 */

import {
  polymarketCtfEventsAbi,
  polymarketNegRiskAdapterAbi,
} from "@cogni/poly-market-provider/adapters/polymarket";
import {
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
  pad,
  toBytes,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";

const FUNDER = "0xaaaa000000000000000000000000000000000001" as const;
const COLLATERAL = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const; // USDC.e
const PARENT_COLLECTION =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const COND =
  "0x86c171b757d290aebed1d5a22e63da3c06900e6e9f42e84ac27baf89fcf09e4b" as const;

function addressTopic(addr: `0x${string}`): `0x${string}` {
  return pad(addr, { size: 32 });
}

describe("CTF PayoutRedemption decode (B1 regression)", () => {
  // CTF event: PayoutRedemption(
  //   address indexed redeemer,
  //   address indexed collateralToken,
  //   bytes32 indexed parentCollectionId,
  //   bytes32 conditionId,
  //   uint256[] indexSets,
  //   uint256 payout
  // )
  const SIG = keccak256(
    toBytes(
      "PayoutRedemption(address,address,bytes32,bytes32,uint256[],uint256)"
    )
  );

  it("recovers conditionId from `data`, NOT `topics[4]` (which is undefined)", () => {
    const data = encodeAbiParameters(
      [
        { type: "bytes32", name: "conditionId" },
        { type: "uint256[]", name: "indexSets" },
        { type: "uint256", name: "payout" },
      ],
      [COND, [1n, 2n], 1_000_000n]
    );
    const log = {
      data,
      topics: [
        SIG,
        addressTopic(FUNDER),
        addressTopic(COLLATERAL),
        PARENT_COLLECTION,
      ] as [`0x${string}`, ...`0x${string}`[]],
    };

    expect(log.topics[4]).toBeUndefined();

    const decoded = decodeEventLog({
      abi: polymarketCtfEventsAbi,
      eventName: "PayoutRedemption",
      data: log.data,
      topics: log.topics,
    });
    const args = decoded.args as unknown as {
      redeemer: `0x${string}`;
      conditionId: `0x${string}`;
    };
    expect(args.redeemer.toLowerCase()).toBe(FUNDER);
    expect(args.conditionId).toBe(COND);
  });
});

describe("NegRiskAdapter PayoutRedemption decode", () => {
  // NegRiskAdapter event: PayoutRedemption(
  //   address indexed redeemer,
  //   bytes32 indexed conditionId,
  //   uint256[] amounts,
  //   uint256 payout
  // )
  const SIG = keccak256(
    toBytes("PayoutRedemption(address,bytes32,uint256[],uint256)")
  );

  it("recovers conditionId from topics[2]", () => {
    const data = encodeAbiParameters(
      [
        { type: "uint256[]", name: "amounts" },
        { type: "uint256", name: "payout" },
      ],
      [[5_000_000n, 0n], 5_000_000n]
    );
    const log = {
      data,
      topics: [SIG, addressTopic(FUNDER), COND] as [
        `0x${string}`,
        ...`0x${string}`[],
      ],
    };

    const decoded = decodeEventLog({
      abi: polymarketNegRiskAdapterAbi,
      eventName: "PayoutRedemption",
      data: log.data,
      topics: log.topics,
    });
    const args = decoded.args as unknown as {
      redeemer: `0x${string}`;
      conditionId: `0x${string}`;
    };
    expect(args.redeemer.toLowerCase()).toBe(FUNDER);
    expect(args.conditionId).toBe(COND);
  });

  it("the two events share a name but produce different topic-0 hashes", () => {
    const ctfSig = keccak256(
      toBytes(
        "PayoutRedemption(address,address,bytes32,bytes32,uint256[],uint256)"
      )
    );
    const negRiskSig = keccak256(
      toBytes("PayoutRedemption(address,bytes32,uint256[],uint256)")
    );
    expect(toHex(ctfSig)).not.toBe(toHex(negRiskSig));
  });
});
