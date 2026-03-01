// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/governance/compose-epoch`
 * Purpose: Verifies epoch view composition for linked and unlinked contributors.
 * Scope: Unit tests for current-epoch UI composition only. Does not test HTTP routes or database queries.
 * Invariants:
 * - UNLINKED_VISIBLE_IN_CURRENT_EPOCH: unresolved contributors render as normal rows
 * - NO_GUID_DISPLAY: contributor names must not fall back to raw user ID prefixes
 * Side-effects: none
 * Links: src/features/governance/lib/compose-epoch.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import { composeEpochView } from "@/features/governance/lib/compose-epoch";

describe("composeEpochView", () => {
  it("includes unresolved contributors as normal rows and uses platform logins", () => {
    const view = composeEpochView(
      {
        id: "12",
        status: "open",
        periodStart: "2026-03-02T00:00:00.000Z",
        periodEnd: "2026-03-09T00:00:00.000Z",
        weightConfig: {
          "github:pr_merged": 8000,
          "github:review_submitted": 2000,
        },
        poolTotalCredits: null,
      },
      [
        {
          userId: "d0000000-0000-4000-a000-000058641509",
          proposedUnits: "8000",
          finalUnits: null,
          activityCount: 1,
        },
      ],
      [
        {
          receiptId: "r1",
          source: "github",
          eventType: "pr_merged",
          platformUserId: "58641509",
          platformLogin: "derekg1729",
          artifactUrl: null,
          eventTime: "2026-03-03T00:00:00.000Z",
          selection: {
            userId: "d0000000-0000-4000-a000-000058641509",
            included: true,
            weightOverrideMilli: null,
          },
        },
        {
          receiptId: "r2",
          source: "github",
          eventType: "review_submitted",
          platformUserId: "90000103",
          platformLogin: "mira-stone",
          artifactUrl: null,
          eventTime: "2026-03-04T00:00:00.000Z",
          selection: {
            userId: null,
            included: true,
            weightOverrideMilli: null,
          },
        },
      ]
    );

    expect(view.contributors).toHaveLength(2);
    expect(
      view.contributors.map((contributor) => contributor.displayName)
    ).toEqual(["derekg1729", "mira-stone"]);
    expect(
      view.contributors.map((contributor) => contributor.claimantKind)
    ).toEqual(["user", "identity"]);
    expect(
      view.contributors.some((contributor) =>
        contributor.displayName?.includes("d0000000")
      )
    ).toBe(false);
  });
});
