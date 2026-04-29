// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: tests/unit/features/redeem/payout-redemption-decode-real
 * Purpose: Ground-truth complement to `payout-redemption-decode.test.ts`. The
 *   sibling test exercises the decode contract using synthetic logs encoded by
 *   viem's own `encodeAbiParameters`; this test exercises it using bytes that
 *   actually appeared on Polygon mainnet. If viem's encode and the live RPC's
 *   wire format ever drift, the synthetic test would silently agree with itself
 *   while real logs broke. This file catches that.
 * Scope: Pure decode of static JSON fixtures. No chain access at test time.
 * Links: tests/fixtures/poly/redeem/README.md, src/features/redeem/redeem-subscriber.ts,
 *   src/features/redeem/redeem-catchup.ts, work/items/task.0388
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  POLYGON_CONDITIONAL_TOKENS,
  POLYGON_NEG_RISK_ADAPTER,
  polymarketCtfEventsAbi,
  polymarketNegRiskAdapterAbi,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { decodeEventLog } from "viem";
import { describe, expect, it } from "vitest";

interface RawLog {
  address: string;
  topics: [`0x${string}`, ...`0x${string}`[]];
  data: `0x${string}`;
  transactionHash: `0x${string}`;
  blockNumber: `0x${string}`;
}

function loadFixture(name: string): RawLog {
  const path = join(__dirname, "../../../fixtures/poly/redeem", name);
  return JSON.parse(readFileSync(path, "utf8")) as RawLog;
}

describe("CTF PayoutRedemption decode (real Polygon mainnet log)", () => {
  const log = loadFixture("ctf-payout-redemption.json");

  it("fixture is a real CTF PayoutRedemption emission", () => {
    expect(log.address.toLowerCase()).toBe(
      POLYGON_CONDITIONAL_TOKENS.toLowerCase()
    );
    // 1 sig topic + 3 indexed args = 4 total. topics[4] does NOT exist.
    expect(log.topics.length).toBe(4);
    expect(log.topics[4]).toBeUndefined();
  });

  it("viem decodes redeemer and conditionId from the right places", () => {
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
    // Operator funder, sourced from Loki bleed_detected event.
    expect(args.redeemer.toLowerCase()).toBe(
      "0x95e407fe03996602ed1bf4289ecb3b5af88b5134"
    );
    // conditionId comes from `data` (NOT topics[4]) — exactly the bug shape.
    expect(args.conditionId).toBe(
      "0x18ec34d073083a5cc3c576e2cdf93fbbb162167ffc4f770dbfa15ba4c2a0927d"
    );
    // Sanity-check: the conditionId bytes are the FIRST 32 bytes of `data`.
    expect(log.data.slice(0, 66)).toBe(
      "0x18ec34d073083a5cc3c576e2cdf93fbbb162167ffc4f770dbfa15ba4c2a0927d"
    );
  });
});

describe("NegRiskAdapter PayoutRedemption decode (real Polygon mainnet log)", () => {
  const log = loadFixture("negrisk-payout-redemption.json");

  it("fixture is a real NegRiskAdapter PayoutRedemption emission", () => {
    expect(log.address.toLowerCase()).toBe(
      POLYGON_NEG_RISK_ADAPTER.toLowerCase()
    );
    // 1 sig topic + 2 indexed args = 3 total. Distinct from CTF.
    expect(log.topics.length).toBe(3);
  });

  it("viem decodes redeemer and conditionId from topics", () => {
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
    expect(args.redeemer.toLowerCase()).toBe(
      "0x31e75c1b1f1885c578d2a5a5dcf8554d21140707"
    );
    expect(args.conditionId).toBe(
      "0x5e87ec054c39e4c497d0da54b509117b8ad410d46505429304a14d9f30fff000"
    );
  });
});

describe("Cross-shape: applying the wrong ABI to the right log fails (or misreads)", () => {
  // This is the teeth of the B1 bug. The two events share the name
  // `PayoutRedemption` but encode `conditionId` in different places. Using
  // the NegRiskAdapter ABI to decode a CTF log either throws (topic-0 mismatch)
  // or silently produces the wrong conditionId — exactly what the v0 raw-topic
  // indexing did. We pin both directions so a future refactor that swaps the
  // ABIs in `redeem-subscriber.handlePayoutRedemption` fails loudly.
  it("CTF log decoded with NegRiskAdapter ABI does NOT recover the right conditionId", () => {
    const log = loadFixture("ctf-payout-redemption.json");
    let mismatch = false;
    try {
      const decoded = decodeEventLog({
        abi: polymarketNegRiskAdapterAbi,
        eventName: "PayoutRedemption",
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as unknown as { conditionId?: `0x${string}` };
      // If viem doesn't throw, the decoded conditionId will not be the real one.
      mismatch =
        args.conditionId?.toLowerCase() !==
        "0x18ec34d073083a5cc3c576e2cdf93fbbb162167ffc4f770dbfa15ba4c2a0927d";
    } catch {
      mismatch = true; // Topic-0 hash mismatch — viem refuses to decode.
    }
    expect(mismatch).toBe(true);
  });

  it("NegRisk log decoded with CTF ABI does NOT recover the right conditionId", () => {
    const log = loadFixture("negrisk-payout-redemption.json");
    let mismatch = false;
    try {
      const decoded = decodeEventLog({
        abi: polymarketCtfEventsAbi,
        eventName: "PayoutRedemption",
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as unknown as { conditionId?: `0x${string}` };
      mismatch =
        args.conditionId?.toLowerCase() !==
        "0x5e87ec054c39e4c497d0da54b509117b8ad410d46505429304a14d9f30fff000";
    } catch {
      mismatch = true;
    }
    expect(mismatch).toBe(true);
  });
});
