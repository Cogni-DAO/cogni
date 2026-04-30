// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/redeem/infer-collateral-token`
 * Purpose: Lock the bug.0428 inference contract — given a known on-chain `positionId`, the helper picks the candidate (`pUSD`, `USDC.e`) whose `getPositionId(token, collectionId)` matches. Wrong inference would re-introduce the silent zero-burn that V2 vanilla CTF redeems used to emit.
 * Scope: Pure unit test. Mocks `PublicClient` view calls; no RPC.
 * Side-effects: none
 * Links: work/items/bug.0428.poly-redeem-worker-hardcodes-usdce.md
 * @internal
 */

import {
  POLYGON_PUSD,
  POLYGON_USDC_E,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { describe, expect, it, vi } from "vitest";

import { inferCollateralTokenForPosition } from "@/features/redeem/infer-collateral-token";

const CONDITION_ID =
  "0x4eaf5295000000000000000000000000000000000000000000000000ffffaaaa" as const;
const COLLECTION_ID =
  "0x9999000000000000000000000000000000000000000000000000000000000000" as const;
const PUSD_POSITION_ID =
  0xaa11aaaa00000000000000000000000000000000000000000000000000000000n;
const USDCE_POSITION_ID =
  0xbb22bbbb00000000000000000000000000000000000000000000000000000000n;

function makeClient(opts: {
  collectionIdResult?: `0x${string}` | "throw";
  pusdPositionId?: bigint;
  usdcePositionId?: bigint;
  multicallResults?: Array<
    { status: "success"; result: bigint } | { status: "failure"; error: Error }
  >;
}) {
  const readContract = vi.fn(async () => {
    if (opts.collectionIdResult === "throw") throw new Error("rpc fail");
    return opts.collectionIdResult ?? COLLECTION_ID;
  });
  const multicall = vi.fn(async () => {
    if (opts.multicallResults) return opts.multicallResults;
    return [
      {
        status: "success",
        result: opts.pusdPositionId ?? PUSD_POSITION_ID,
      },
      {
        status: "success",
        result: opts.usdcePositionId ?? USDCE_POSITION_ID,
      },
    ];
  });
  return { readContract, multicall } as unknown as Parameters<
    typeof inferCollateralTokenForPosition
  >[0]["publicClient"];
}

describe("inferCollateralTokenForPosition", () => {
  it("returns pUSD when funder's positionId matches the pUSD candidate (V2)", async () => {
    const out = await inferCollateralTokenForPosition({
      publicClient: makeClient({}),
      conditionId: CONDITION_ID,
      outcomeIndex: 0,
      expectedPositionId: PUSD_POSITION_ID,
    });
    expect(out.collateralToken).toBe(POLYGON_PUSD);
    expect(out.inferredFrom).toBe("chain_probe_pusd");
  });

  it("returns USDC.e when funder's positionId matches the USDC.e candidate (V1 legacy)", async () => {
    const out = await inferCollateralTokenForPosition({
      publicClient: makeClient({}),
      conditionId: CONDITION_ID,
      outcomeIndex: 1,
      expectedPositionId: USDCE_POSITION_ID,
    });
    expect(out.collateralToken).toBe(POLYGON_USDC_E);
    expect(out.inferredFrom).toBe("chain_probe_usdce");
  });

  it("falls back to USDC.e with default_no_match when neither candidate hashes to the funder's positionId", async () => {
    const out = await inferCollateralTokenForPosition({
      publicClient: makeClient({}),
      conditionId: CONDITION_ID,
      outcomeIndex: 0,
      expectedPositionId: 0xdeadbeefdeadbeefn,
    });
    expect(out.collateralToken).toBe(POLYGON_USDC_E);
    expect(out.inferredFrom).toBe("default_no_match");
  });

  it("falls back to USDC.e with default_read_failed when getCollectionId throws (RPC outage)", async () => {
    const out = await inferCollateralTokenForPosition({
      publicClient: makeClient({ collectionIdResult: "throw" }),
      conditionId: CONDITION_ID,
      outcomeIndex: 0,
      expectedPositionId: PUSD_POSITION_ID,
    });
    expect(out.collateralToken).toBe(POLYGON_USDC_E);
    expect(out.inferredFrom).toBe("default_read_failed");
  });

  it("ignores failed multicall entries and matches against the successful ones only", async () => {
    const out = await inferCollateralTokenForPosition({
      publicClient: makeClient({
        multicallResults: [
          { status: "failure", error: new Error("rpc fail on pusd") },
          { status: "success", result: USDCE_POSITION_ID },
        ],
      }),
      conditionId: CONDITION_ID,
      outcomeIndex: 0,
      expectedPositionId: USDCE_POSITION_ID,
    });
    expect(out.collateralToken).toBe(POLYGON_USDC_E);
    expect(out.inferredFrom).toBe("chain_probe_usdce");
  });

  it("preserves V2-prefer order — when both candidates somehow match, picks pUSD first", async () => {
    // Defensive against a degenerate chain state. In practice positionIds for
    // distinct collateralTokens are distinct (keccak collision-resistance), but
    // the iteration order in the helper is the contract — pUSD is checked first
    // so V2 wins on tie. Asserts the comparator's stability.
    const out = await inferCollateralTokenForPosition({
      publicClient: makeClient({
        pusdPositionId: 0xc0ffeen,
        usdcePositionId: 0xc0ffeen,
      }),
      conditionId: CONDITION_ID,
      outcomeIndex: 0,
      expectedPositionId: 0xc0ffeen,
    });
    expect(out.collateralToken).toBe(POLYGON_PUSD);
    expect(out.inferredFrom).toBe("chain_probe_pusd");
  });
});
