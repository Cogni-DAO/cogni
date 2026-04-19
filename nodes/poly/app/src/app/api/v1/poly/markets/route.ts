// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/markets/route`
 * Purpose: Server-side proxy to Polymarket Gamma API for condition_id → market title/slug lookup. Exists because `gamma-api.polymarket.com` returns no CORS headers, so browser fetches from the dashboard are blocked by the browser.
 * Scope: Pure proxy. Validates `condition_ids` query param (comma-separated 0x… hexes, capped). Forwards to Gamma. Returns a narrow `{ markets: [{ conditionId, question, slug }] }` shape — NOT the full Gamma row.
 * Invariants:
 *   - AUTH_REQUIRED: internal dashboard endpoint; session required.
 *   - READ_ONLY + NO_SECRETS: Gamma is a public read-only API.
 *   - CAPPED_FANOUT: max 50 condition_ids per call (Gamma handles more, but we don't want the dashboard to send unbounded URLs).
 * Side-effects: IO (HTTPS fetch to gamma-api.polymarket.com).
 * @public
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/app/_lib/auth/session";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";

const QuerySchema = z.object({
  condition_ids: z
    .string()
    .min(3)
    .transform((s) =>
      s
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter((v) => /^0x[a-f0-9]+$/.test(v) && v.length <= 66)
    )
    .pipe(z.array(z.string()).min(1).max(50)),
});

const GAMMA_BASE = "https://gamma-api.polymarket.com";

interface GammaMarket {
  conditionId?: string;
  question?: string;
  slug?: string;
}

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.markets",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, request) => {
    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      condition_ids: searchParams.get("condition_ids") ?? "",
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid condition_ids", details: parsed.error.format() },
        { status: 400 }
      );
    }

    try {
      const upstream = new URL(`${GAMMA_BASE}/markets`);
      upstream.searchParams.set(
        "condition_ids",
        parsed.data.condition_ids.join(",")
      );
      const res = await fetch(upstream.toString(), {
        // Gamma is slow at p99; 5s is generous but bounded.
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return NextResponse.json({ markets: [] });
      }
      const raw = (await res.json()) as GammaMarket[];
      const markets = raw
        .filter(
          (m): m is Required<Pick<GammaMarket, "conditionId">> & GammaMarket =>
            typeof m?.conditionId === "string"
        )
        .map((m) => ({
          conditionId: m.conditionId.toLowerCase(),
          question: m.question ?? "",
          slug: m.slug ?? "",
        }));
      return NextResponse.json({ markets });
    } catch {
      // Graceful degrade — the card renders the truncated conditionId fallback.
      return NextResponse.json({ markets: [] });
    }
  }
);
