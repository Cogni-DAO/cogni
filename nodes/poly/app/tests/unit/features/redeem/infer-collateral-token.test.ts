// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/redeem/infer-collateral-token`
 * Purpose: Lock the bug.0428 contract — given a known on-chain `positionId`, the helper picks the candidate whose `getPositionId(token, collectionId)` matches; falls back to USDC.e on non-match or RPC failure.
 * Side-effects: none (mocks PublicClient).
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
  collectionIdThrows?: boolean;
  positionIds?: [bigint, bigint]; // [pUSD, USDC.e]
}) {
  const readContract = vi.fn(async () => {
    if (opts.collectionIdThrows) throw new Error("rpc fail");
    return COLLECTION_ID;
  });
  const multicall = vi.fn(async () => {
    const [pusd, usdce] = opts.positionIds ?? [
      PUSD_POSITION_ID,
      USDCE_POSITION_ID,
    ];
    return [
      { status: "success", result: pusd },
      { status: "success", result: usdce },
    ];
  });
  return { readContract, multicall } as unknown as Parameters<
    typeof inferCollateralTokenForPosition
  >[0]["publicClient"];
}

describe("inferCollateralTokenForPosition", () => {
  it("returns pUSD when funder's positionId hashes from pUSD (V2)", async () => {
    const out = await inferCollateralTokenForPosition({
      publicClient: makeClient({}),
      conditionId: CONDITION_ID,
      outcomeIndex: 0,
      expectedPositionId: PUSD_POSITION_ID,
    });
    expect(out).toBe(POLYGON_PUSD);
  });

  it("returns USDC.e when funder's positionId hashes from USDC.e (V1)", async () => {
    const out = await inferCollateralTokenForPosition({
      publicClient: makeClient({}),
      conditionId: CONDITION_ID,
      outcomeIndex: 1,
      expectedPositionId: USDCE_POSITION_ID,
    });
    expect(out).toBe(POLYGON_USDC_E);
  });

  it("falls back to USDC.e on non-match or RPC failure", async () => {
    const noMatch = await inferCollateralTokenForPosition({
      publicClient: makeClient({}),
      conditionId: CONDITION_ID,
      outcomeIndex: 0,
      expectedPositionId: 0xdeadbeefn,
    });
    expect(noMatch).toBe(POLYGON_USDC_E);

    const rpcFailed = await inferCollateralTokenForPosition({
      publicClient: makeClient({ collectionIdThrows: true }),
      conditionId: CONDITION_ID,
      outcomeIndex: 0,
      expectedPositionId: PUSD_POSITION_ID,
    });
    expect(rpcFailed).toBe(POLYGON_USDC_E);
  });
});
