// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/features/wallet-analysis/poly-market-metadata-service`
 * Purpose: Locks the Gamma → `poly_market_metadata` row mapping. Any change
 *   to the schema (new field, renamed column, null-handling tweak) must keep
 *   these cases green. Pure transform — no DB, no HTTP.
 * Scope: Pure unit test.
 * Invariants: Markets with missing/empty `conditionId` are dropped (Gamma
 *   sometimes returns these for malformed routes). `events[0].title` and
 *   `events[0].slug` map to `eventTitle` / `eventSlug`. `endDate` parses
 *   ISO strings, returns null on garbage.
 * Side-effects: none
 * Links: nodes/poly/app/src/features/wallet-analysis/server/poly-market-metadata-service.ts
 * @public
 */

import type { GammaMarket } from "@cogni/poly-market-provider/adapters/polymarket";
import { describe, expect, it } from "vitest";

import {
  dedupeRowsByConditionId,
  gammaMarketsToMetadataRows,
} from "@/features/wallet-analysis/server/poly-market-metadata-service";

const FETCHED_AT = new Date("2026-05-05T12:00:00Z");

function market(overrides: Partial<GammaMarket> = {}): GammaMarket {
  return {
    conditionId: "0xabc",
    question: "Will it rain?",
    slug: "will-it-rain",
    endDate: "2026-06-01T00:00:00Z",
    closed: false,
    events: [{ title: "Weather Bets", slug: "weather-bets" }],
    ...overrides,
  };
}

describe("gammaMarketsToMetadataRows", () => {
  it("maps a fully-populated market into a row", () => {
    const rows = gammaMarketsToMetadataRows([market()], FETCHED_AT);
    expect(rows).toEqual([
      {
        conditionId: "0xabc",
        marketTitle: "Will it rain?",
        marketSlug: "will-it-rain",
        eventTitle: "Weather Bets",
        eventSlug: "weather-bets",
        endDate: new Date("2026-06-01T00:00:00Z"),
        raw: market(),
        fetchedAt: FETCHED_AT,
      },
    ]);
  });

  it("drops markets without a conditionId (Gamma malformed-route quirk)", () => {
    const rows = gammaMarketsToMetadataRows(
      [
        market({ conditionId: undefined }),
        market({ conditionId: "" }),
        market({ conditionId: "0xkeep" }),
      ],
      FETCHED_AT
    );
    expect(rows.map((r) => r.conditionId)).toEqual(["0xkeep"]);
  });

  it("returns null for missing event metadata", () => {
    const rows = gammaMarketsToMetadataRows(
      [market({ events: [] })],
      FETCHED_AT
    );
    expect(rows[0]?.eventTitle).toBeNull();
    expect(rows[0]?.eventSlug).toBeNull();
  });

  it("preserves null/undefined optional fields cleanly", () => {
    const rows = gammaMarketsToMetadataRows(
      [
        market({
          question: null,
          slug: null,
          endDate: null,
        }),
      ],
      FETCHED_AT
    );
    expect(rows[0]).toMatchObject({
      conditionId: "0xabc",
      marketTitle: null,
      marketSlug: null,
      endDate: null,
    });
  });

  it("returns null endDate when the ISO string is unparseable", () => {
    const rows = gammaMarketsToMetadataRows(
      [market({ endDate: "not-a-date" })],
      FETCHED_AT
    );
    expect(rows[0]?.endDate).toBeNull();
  });

  it("preserves the full Gamma payload in `raw` for forward-compatibility", () => {
    const exotic = market({
      conditionId: "0xexotic",
      // biome-ignore lint/suspicious/noExplicitAny: simulating future Gamma fields
    } as any);
    (exotic as unknown as Record<string, unknown>).futureField = 42;
    const rows = gammaMarketsToMetadataRows([exotic], FETCHED_AT);
    expect(rows[0]?.raw).toEqual(exotic);
  });

  it("returns an empty array on empty input", () => {
    expect(gammaMarketsToMetadataRows([], FETCHED_AT)).toEqual([]);
  });
});

describe("dedupeRowsByConditionId", () => {
  it("keeps the last occurrence per conditionId (matches upsert semantics)", () => {
    const rows = [
      { conditionId: "0xabc", marketTitle: "first" },
      { conditionId: "0xabc", marketTitle: "second" },
      { conditionId: "0xdef", marketTitle: "other" },
    ];
    expect(dedupeRowsByConditionId(rows)).toEqual([
      { conditionId: "0xabc", marketTitle: "second" },
      { conditionId: "0xdef", marketTitle: "other" },
    ]);
  });

  it("is a no-op when all conditionIds are already distinct", () => {
    const rows = [
      { conditionId: "0xa" },
      { conditionId: "0xb" },
      { conditionId: "0xc" },
    ];
    expect(dedupeRowsByConditionId(rows)).toEqual(rows);
  });

  it("returns an empty array on empty input", () => {
    expect(dedupeRowsByConditionId([])).toEqual([]);
  });
});
