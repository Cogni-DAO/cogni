// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/2026-05-07/page`
 * Purpose: Static dated alpha-leak report — first full day post-bug.5032
 *          (mirror-WS pagination + cold-start clamp). Decision-coverage on
 *          swisstony went from ~24% → ~100% at 2026-05-07 05:19 UTC. The
 *          summary numbers below mix ~13h pre-fix + ~11h post-fix; the
 *          per-market table overlays the new full-coverage histograms onto
 *          the ranked leak set.
 * Scope: Server component, auth-gated. Hardcoded data; no DB calls. Replace
 *        with a dated successor when the next report runs.
 * Side-effects: IO (auth check)
 * Links:
 *   - .claude/skills/data-research/recipes/alpha-leak-debug.md (taxonomy + recipes)
 *   - ../2026-05-06/page.tsx (predecessor — frozen pre-fix snapshot)
 *   - bug.5032 — mirror-WS pagination + cold-start clamp (PR #1295)
 * @public
 */

import { redirect } from "next/navigation";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { getServerSessionUser } from "@/lib/auth/server";

const REPORT_DATE = "2026-05-07";
const WINDOW = "trailing 24h (cutover 05:19 UTC)";
const TARGET_LABEL = "swisstony";
const OUR_LABEL = "Tenant trading wallet";

const SUMMARY = {
  target_fills_1d: 10_921,
  placed: 492, // 311 ok + 153 layer_scale_in + 28 hedge_followup
  placed_ok: 311,
  errors: 286,
  skipped: 4060,
  never_emitted: 6083, // pre-fix backlog only — post-fix this is ≈ 0
  leak_markets: 54,
  swisstony_gain_on_leak_markets_usdc: 89_020,
  our_loss_on_leak_markets_usdc: -352.97,
} as const;

const PRE_VS_POST = {
  pre_fix_fills: 17_415,
  pre_fix_placed: 606,
  pre_fix_placed_pct: 3.48,
  pre_fix_cov_pct: 24.5,
  post_fix_fills: 2404,
  post_fix_placed: 186,
  post_fix_placed_pct: 7.74,
  post_fix_cov_pct: 100,
} as const;

// Apples-to-apples filter comparison: swisstony fill size_usdc over the last
// 48h (n=30,216) vs the snapshot frozen in copy-trade-mirror.job.ts on
// 2026-05-03 (n=1085). The baseline n is itself biased — that snapshot was
// captured while bug.5032 was silently dropping ~76% of swisstony's fills,
// so the surviving 1085 skewed toward the largest recent fills.
const PXX_DRIFT: ReadonlyArray<{
  pct: number;
  live: number;
  baseline: number | null;
}> = [
  { pct: 0, live: 0, baseline: null },
  { pct: 10, live: 0.72, baseline: null },
  { pct: 20, live: 1.43, baseline: null },
  { pct: 30, live: 2.33, baseline: null },
  { pct: 40, live: 3.6, baseline: null },
  { pct: 50, live: 6.14, baseline: 31 },
  { pct: 60, live: 11.44, baseline: null },
  { pct: 70, live: 23.29, baseline: null },
  { pct: 75, live: 34.4, baseline: 146 },
  { pct: 80, live: 56.15, baseline: null }, // active filter percentile
  { pct: 90, live: 176, baseline: 665 },
  { pct: 95, live: 372.42, baseline: 1394 },
  { pct: 99, live: 1200.02, baseline: 4809 },
  { pct: 100, live: 36_160.8, baseline: null },
];

const PXX_META = {
  live_n: 30_216,
  live_window: "trailing 48h ending 2026-05-07 ~16:00 UTC",
  baseline_n: 1085,
  baseline_captured: "2026-05-03 02:34 UTC",
} as const;

const ERROR_BUCKETS_1D: ReadonlyArray<{ reason: string; n: number }> = [
  { reason: "placement_failed", n: 286 }, // 100% of errors are placement_failed in this window
];

type MarketRow = {
  condition_id: string;
  title: string;
  event_slug: string | null;
  their_pnl_usdc: number;
  our_pnl_usdc: number;
  our_cost_usdc: number;
  their_cost_usdc: number;
  size_x: number | null;
  target_fills_1d: number;
  never_emitted: number;
  placed: number;
  errors: number;
  skipped: number;
  top_skip_reason: string | null;
  top_error_reason: string | null;
  diagnosis: string;
  notes: string;
};

const ROWS: ReadonlyArray<MarketRow> = [
  {
    condition_id:
      "0x05c61ab4275ae67d8b05c3593ee70e740fc0e757cfa2e41d522b7c9bda685692",
    title: "Internazionali BNL d'Italia: Zhang vs Altmaier",
    event_slug: "atp-zhang-altmaie-2026-05-06",
    their_pnl_usdc: 5549,
    our_pnl_usdc: -8.46,
    our_cost_usdc: 8.46,
    their_cost_usdc: 7793,
    size_x: 921,
    target_fills_1d: 0,
    never_emitted: 0,
    placed: 0,
    errors: 0,
    skipped: 0,
    top_skip_reason: null,
    top_error_reason: null,
    diagnosis:
      "Carry-only — no swisstony fills in the last 24h; price moved in their favor on a position opened earlier (also #2 on the 05-06 leak board). Our $8.46 entry is too small to scale into the move. Pure size-cap asymmetry.",
    notes: "Same condition as #2 on 2026-05-06 report.",
  },
  {
    condition_id:
      "0xc50831975e60b6665a0c4062af1d08ceeaf968a69b38978bf57dae0e90dcdfa0",
    title: "Kawasaki Frontale vs. Tōkyō Verdy: O/U 1.5",
    event_slug: "j1100-kaw-ver-2026-05-06-more-markets",
    their_pnl_usdc: 3854,
    our_pnl_usdc: -3.51,
    our_cost_usdc: 3.51,
    their_cost_usdc: 6336,
    size_x: 1804,
    target_fills_1d: 0,
    never_emitted: 0,
    placed: 0,
    errors: 0,
    skipped: 0,
    top_skip_reason: null,
    top_error_reason: null,
    diagnosis:
      "Carry-only continuation of the 05-06 leak (same condition_id, +$457 since yesterday). 1804× size means we capture ~0.06% of edge.",
    notes: "Same condition as #5 on 2026-05-06 report.",
  },
  {
    condition_id:
      "0x1c22d58fe1f4283b3f743213ca02560d27ef0bc4caa1c2c59ac63270dce37c68",
    title: "Will Sanfrecce Hiroshima win on 2026-05-06?",
    event_slug: "j1100-san-vis-2026-05-06",
    their_pnl_usdc: 3657,
    our_pnl_usdc: -11.75,
    our_cost_usdc: 11.75,
    their_cost_usdc: 2681,
    size_x: 228,
    target_fills_1d: 0,
    never_emitted: 0,
    placed: 0,
    errors: 0,
    skipped: 0,
    top_skip_reason: null,
    top_error_reason: null,
    diagnosis:
      "Carry-only. Best size ratio in the top-3 (228×) but the position was already set pre-window. Our $11.75 entry rode the move down, not up.",
    notes: "",
  },
  {
    condition_id:
      "0x117afac59081943ddb0f9ad7c098adf141e912062156235cb2ce5ae0b9bc591b",
    title: "Ducks vs. Golden Knights",
    event_slug: "nhl-ana-las-2026-05-06",
    their_pnl_usdc: 3011,
    our_pnl_usdc: -2.24,
    our_cost_usdc: 2.24,
    their_cost_usdc: 5187,
    size_x: 2316,
    target_fills_1d: 35,
    never_emitted: 18,
    placed: 2,
    errors: 0,
    skipped: 15,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: null,
    diagnosis:
      "Mixed pre/post-fix window: 18/35 never_emitted is the pre-cutover backlog. Post-cutover, 15 skipped as followup_position_too_small — base entry $2.24 means scale-ins round to dust.",
    notes: "",
  },
  {
    condition_id:
      "0x27c74db90b4474968cbdc0f390487fb5b917c112fbc8582321ac34c488eef4a9",
    title: "76ers vs. Knicks: O/U 215.5",
    event_slug: "nba-phi-nyk-2026-05-06",
    their_pnl_usdc: 2939,
    our_pnl_usdc: -4.85,
    our_cost_usdc: 4.85,
    their_cost_usdc: 1427,
    size_x: 294,
    target_fills_1d: 28,
    never_emitted: 13,
    placed: 2,
    errors: 0,
    skipped: 13,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: null,
    diagnosis:
      "Same condition as #7 on 05-06 report (now +$337). Coverage gap (13 pre-fix never_emitted) plus 13 post-fix followup_position_too_small skips. Lowest size ratio (294×) of the top-5 — best candidate for sizing-based recovery.",
    notes: "Same condition as #7 on 2026-05-06 report.",
  },
  {
    condition_id:
      "0x0753f0c04a22192765ffc339a57929fa698bb4b61e8d4763d5d5fa04424945a1",
    title: "Cleveland Guardians vs. Kansas City Royals",
    event_slug: "mlb-cle-kc-2026-05-06",
    their_pnl_usdc: 2556,
    our_pnl_usdc: -3.49,
    our_cost_usdc: 3.49,
    their_cost_usdc: 2145,
    size_x: 615,
    target_fills_1d: 85,
    never_emitted: 58,
    placed: 2,
    errors: 0,
    skipped: 25,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: null,
    diagnosis:
      "Heavy pre-fix backlog (58/85 never_emitted) + post-fix scale-in dust. 85 swisstony fills is one of the busiest leak markets — coverage gap is the dominant lost edge.",
    notes: "",
  },
  {
    condition_id:
      "0x3d1c1d96948fe74dd5074638764492911ae0a05448b827f9f17d12d6a4cbae22",
    title: "Will Tōkyō Verdy win on 2026-05-06?",
    event_slug: "j1100-kaw-ver-2026-05-06",
    their_pnl_usdc: 2527,
    our_pnl_usdc: -3.23,
    our_cost_usdc: 3.23,
    their_cost_usdc: 7520,
    size_x: 2329,
    target_fills_1d: 0,
    never_emitted: 0,
    placed: 0,
    errors: 0,
    skipped: 0,
    top_skip_reason: null,
    top_error_reason: null,
    diagnosis:
      "Carry-only continuation of #11 from 05-06 (+$841 since). Co-occurs with the O/U 1.5 leak above on the same J1 fixture. 2329× size means we caught essentially none.",
    notes: "Same condition as #11 on 2026-05-06 report.",
  },
  {
    condition_id:
      "0x840caa5bd31d364838b0acbdbfded39a1aa1e0860ceb849b3b03cfcc4c856f30",
    title: "Sanfrecce Hiroshima vs. Vissel Kōbe: O/U 2.5",
    event_slug: "j1100-san-vis-2026-05-06-more-markets",
    their_pnl_usdc: 2164,
    our_pnl_usdc: -4.61,
    our_cost_usdc: 4.61,
    their_cost_usdc: 2555,
    size_x: 555,
    target_fills_1d: 0,
    never_emitted: 0,
    placed: 0,
    errors: 0,
    skipped: 0,
    top_skip_reason: null,
    top_error_reason: null,
    diagnosis:
      "Carry-only. Co-occurs with the Sanfrecce moneyline leak — swisstony layered both legs, we caught one (smaller).",
    notes: "",
  },
  {
    condition_id:
      "0x6ff529c64645d443c110eac6ba12c30c6561f7152905b9e92a57ba987aeb2edf",
    title: "Internazionali BNL d'Italia: Putintseva vs Valentova",
    event_slug: "wta-putints-valento-2026-05-05",
    their_pnl_usdc: 2004,
    our_pnl_usdc: -2.82,
    our_cost_usdc: 2.82,
    their_cost_usdc: 20_875,
    size_x: 7402,
    target_fills_1d: 10,
    never_emitted: 6,
    placed: 0,
    errors: 0,
    skipped: 4,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: null,
    diagnosis:
      "Most extreme size asymmetry in the table (7402×). swisstony rode $20.8k cost basis to a $2k win; we placed nothing. 6 pre-fix never_emitted + 4 followup-too-small post-fix.",
    notes: "",
  },
  {
    condition_id:
      "0xf01918eea22a0e322918de91230de4c3c23af0fbae614994896ffd4a1493b115",
    title: "Will Beijing Guoan FC win on 2026-05-06?",
    event_slug: "chi-bgu-ygb-2026-05-06",
    their_pnl_usdc: 1987,
    our_pnl_usdc: -5.18,
    our_cost_usdc: 5.18,
    their_cost_usdc: 2912,
    size_x: 562,
    target_fills_1d: 0,
    never_emitted: 0,
    placed: 0,
    errors: 0,
    skipped: 0,
    top_skip_reason: null,
    top_error_reason: null,
    diagnosis: "Carry-only. swisstony was already in; no new fills today.",
    notes: "",
  },
  {
    condition_id:
      "0x69c61cc011bb3e99f5ec34a6d83d63454330b8fad088bb82d8b5b041b9d2685d",
    title: "Istanbul: Fruhvirtova vs Pigossi",
    event_slug: "wta-fruhvir-pigossi-2026-05-07",
    their_pnl_usdc: 1982,
    our_pnl_usdc: -12.78,
    our_cost_usdc: 12.78,
    their_cost_usdc: 4004,
    size_x: 313,
    target_fills_1d: 138,
    never_emitted: 0,
    placed: 10,
    errors: 6,
    skipped: 122,
    top_skip_reason: "below_target_percentile",
    top_error_reason: "placement_failed",
    diagnosis:
      "Highest-priority debug — the leak the fix made VISIBLE. 100% emit coverage on 138 fills. Skip breakdown: 32 below_target_percentile (avg $9.59), 31 target_position_below_threshold (avg $58.94), 16 already_resting (avg $757.67 — large swisstony entries we missed at our own resting prices), 15 followup_position_too_small, 15 position_cap_reached, 13 followup_not_needed. 6 placement errors. 10 placed (3 ok at avg $651, 7 layer_scale_in at avg $145). Biggest lost edge is already_resting × $757 avg — those were sizable bets we should have caught.",
    notes:
      "Skip histogram captured directly from poly_copy_trade_decisions on 2026-05-07.",
  },
  {
    condition_id:
      "0x635cbd45d09e8508967adabadf4b446a1cc0ab5162c74cdcf3b11c617cd04f96",
    title: "Kawasaki Frontale vs. Tōkyō Verdy: Both Teams to Score",
    event_slug: "j1100-kaw-ver-2026-05-06-more-markets",
    their_pnl_usdc: 1846,
    our_pnl_usdc: -1.66,
    our_cost_usdc: 1.66,
    their_cost_usdc: 3952,
    size_x: 2380,
    target_fills_1d: 0,
    never_emitted: 0,
    placed: 0,
    errors: 0,
    skipped: 0,
    top_skip_reason: null,
    top_error_reason: null,
    diagnosis:
      "Carry-only. Third leg of the same Kawasaki–Verdy fixture (alongside O/U 1.5 + moneyline). swisstony hedged across all three; we caught micro-positions on each.",
    notes: "",
  },
  {
    condition_id:
      "0x3e29051e392ced6f9ee559a48b272271e4599dbc41502483a90bbff4e79a23a2",
    title: "Internazionali BNL d'Italia: Paolini vs Jeanjean",
    event_slug: "wta-paolini-jeanjea-2026-05-07",
    their_pnl_usdc: 1755,
    our_pnl_usdc: -3.07,
    our_cost_usdc: 3.07,
    their_cost_usdc: 8166,
    size_x: 2659,
    target_fills_1d: 75,
    never_emitted: 0,
    placed: 13,
    errors: 0,
    skipped: 62,
    top_skip_reason: "already_resting",
    top_error_reason: null,
    diagnosis:
      "Post-fix coverage clean (0 never_emitted) and the highest placed-count of any leak (13). 62 already_resting skips suggest the resting orders weren't refreshed when swisstony moved through them. Best surface for resting-order TTL tuning.",
    notes: "",
  },
  {
    condition_id:
      "0x64562d2a13d04c9e590ca640c26a2f7cce42de7a8e7a0056e3ffc7c4226092f6",
    title: "Shanghai Haigang vs. Shenzhen Xinpengcheng: O/U 2.5",
    event_slug: "chi-shp-xin-2026-05-06-more-markets",
    their_pnl_usdc: 1589,
    our_pnl_usdc: -7.82,
    our_cost_usdc: 7.82,
    their_cost_usdc: 2904,
    size_x: 371,
    target_fills_1d: 0,
    never_emitted: 0,
    placed: 0,
    errors: 0,
    skipped: 0,
    top_skip_reason: null,
    top_error_reason: null,
    diagnosis: "Carry-only. swisstony in pre-window, position rode the move.",
    notes: "",
  },
  {
    condition_id:
      "0xa11f14243031feb0114e6edfc3461757ed2499870b3469a707374b04e30334a6",
    title: "Will CS Independiente Rivadavia win on 2026-05-06?",
    event_slug: "lib-cir-flu-2026-05-06",
    their_pnl_usdc: 1544,
    our_pnl_usdc: -3.15,
    our_cost_usdc: 3.15,
    their_cost_usdc: 702,
    size_x: 223,
    target_fills_1d: 75,
    never_emitted: 61,
    placed: 3,
    errors: 0,
    skipped: 11,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: null,
    diagnosis:
      "Best size ratio of the active-fill leaks (223×) but coverage gap (61/75 never_emitted) is dominant — 81% of swisstony's fills here landed pre-fix. Post-fix slice has 11 followup-too-small skips on a $3.15 base.",
    notes: "",
  },
  {
    condition_id:
      "0xc0f7b8a380d23da353be94a6195881972813f4198db3d1bed8ea553aa946aed7",
    title: "Brewers vs. Cardinals: O/U 8.5",
    event_slug: "mlb-mil-stl-2026-05-06",
    their_pnl_usdc: 1421,
    our_pnl_usdc: -4.26,
    our_cost_usdc: 4.26,
    their_cost_usdc: 1041,
    size_x: 244,
    target_fills_1d: 71,
    never_emitted: 51,
    placed: 2,
    errors: 0,
    skipped: 18,
    top_skip_reason: "below_target_percentile",
    top_error_reason: null,
    diagnosis:
      "Coverage gap dominant (51/71 never_emitted, all pre-fix). Top post-fix skip reason is below_target_percentile — second leak market (after Fruhvirtova/Pigossi above) where the static p80 filter visibly dominates.",
    notes: "",
  },
  {
    condition_id:
      "0xc51dbfc2fcfa61d70418c1aa3b4275fb3b4e5201f6c91c69c194a8e8c05baf7c",
    title: "Timberwolves vs. Spurs: O/U 217.5",
    event_slug: "nba-min-sas-2026-05-06",
    their_pnl_usdc: 1372,
    our_pnl_usdc: -4.63,
    our_cost_usdc: 4.63,
    their_cost_usdc: 237,
    size_x: 51,
    target_fills_1d: 31,
    never_emitted: 11,
    placed: 1,
    errors: 0,
    skipped: 19,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: null,
    diagnosis:
      "Lowest size ratio in the table (51×) — closest to a fair fight. swisstony made $1.4k on $237 cost basis (a 580% return). Even here we placed only 1 and skipped 19. Followup_position_too_small is the kill.",
    notes: "",
  },
  {
    condition_id:
      "0x6495f74913a1a4b90a71658c3d5837f174b49dc8078a1de854d3a922b5cf7b3b",
    title: "CD Tolima vs. Club Nacional: O/U 2.5",
    event_slug: "lib-tol-nac-2026-05-06-more-markets",
    their_pnl_usdc: 1352,
    our_pnl_usdc: -18.02,
    our_cost_usdc: 18.02,
    their_cost_usdc: 575,
    size_x: 32,
    target_fills_1d: 22,
    never_emitted: 13,
    placed: 3,
    errors: 0,
    skipped: 6,
    top_skip_reason: "already_resting",
    top_error_reason: null,
    diagnosis:
      "Most-evenly-sized leak in the table (32×) and largest absolute cash loss ($-18.02). Coverage gap is modest (13/22), top post-fix skip is already_resting — same resting-order-staleness pattern as the Paolini/Jeanjean row.",
    notes: "",
  },
];

function fmtUsd(n: number, dp = 2): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
}

function pmLink(slug: string | null): string | null {
  if (!slug) return null;
  return `https://polymarket.com/event/${slug}`;
}

function lokiTemplate(conditionId: string): string {
  return `{namespace="poly-production", app="poly-app"} |= "${conditionId}"`;
}

export default async function AlphaLeakReportPage() {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/");
  }

  const placed_pct = (SUMMARY.placed / SUMMARY.target_fills_1d) * 100;
  const never_emitted_pct =
    (SUMMARY.never_emitted / SUMMARY.target_fills_1d) * 100;

  return (
    <div className="flex flex-col gap-6 p-5 md:p-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-semibold text-2xl">
          Alpha-leak report — {REPORT_DATE}
        </h1>
        <p className="text-muted-foreground text-sm">
          Markets where <code>{TARGET_LABEL}</code> made money over the {WINDOW}{" "}
          and we (<code>{OUR_LABEL}</code>) lost. <strong>Cutover note:</strong>{" "}
          bug.5032 (mirror-WS pagination + cold-start clamp) shipped to prod
          2026-05-07 05:19 UTC. swisstony decision-coverage stepped from ~24% →
          ~100%. Pre/post numbers are split out below — the per-market table
          mixes them. Frozen snapshot — replace with a successor when re-run.
          Recipe pack:{" "}
          <code>.claude/skills/data-research/recipes/alpha-leak-debug.md</code>.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card
          title="swisstony fills (1d)"
          value={SUMMARY.target_fills_1d.toLocaleString()}
        />
        <Card
          title="never_emitted (pre-fix)"
          value={`${SUMMARY.never_emitted.toLocaleString()} (${never_emitted_pct.toFixed(0)}%)`}
          tone="bad"
        />
        <Card
          title="placed"
          value={`${SUMMARY.placed.toLocaleString()} (${placed_pct.toFixed(1)}%)`}
        />
        <Card
          title="errors"
          value={SUMMARY.errors.toLocaleString()}
          tone="bad"
        />
        <Card
          title="leak markets (1d)"
          value={SUMMARY.leak_markets.toLocaleString()}
        />
        <Card
          title="swisstony gain on leaks"
          value={fmtUsd(SUMMARY.swisstony_gain_on_leak_markets_usdc, 0)}
          tone="good"
        />
        <Card
          title="our cash loss on leaks"
          value={fmtUsd(SUMMARY.our_loss_on_leak_markets_usdc)}
          tone="bad"
        />
        <Card title="skipped" value={SUMMARY.skipped.toLocaleString()} />
      </section>

      <section>
        <h2 className="mb-2 font-medium text-lg">
          Pre-fix vs post-fix (swisstony, 24h split at 05:19 UTC)
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Window</TableHead>
              <TableHead className="text-right">Fills</TableHead>
              <TableHead className="text-right">Coverage</TableHead>
              <TableHead className="text-right">Placed</TableHead>
              <TableHead className="text-right">Placed %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <code>pre_fix</code> (24h to 2026-05-07 05:00Z)
              </TableCell>
              <TableCell className="text-right">
                {PRE_VS_POST.pre_fix_fills.toLocaleString()}
              </TableCell>
              <TableCell className="text-right text-destructive">
                {PRE_VS_POST.pre_fix_cov_pct}%
              </TableCell>
              <TableCell className="text-right">
                {PRE_VS_POST.pre_fix_placed}
              </TableCell>
              <TableCell className="text-right">
                {PRE_VS_POST.pre_fix_placed_pct}%
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code>post_fix</code> (since 2026-05-07 06:00Z)
              </TableCell>
              <TableCell className="text-right">
                {PRE_VS_POST.post_fix_fills.toLocaleString()}
              </TableCell>
              <TableCell className="text-right text-success">
                {PRE_VS_POST.post_fix_cov_pct}%
              </TableCell>
              <TableCell className="text-right">
                {PRE_VS_POST.post_fix_placed}
              </TableCell>
              <TableCell className="text-right text-success">
                {PRE_VS_POST.post_fix_placed_pct}%
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="mt-2 text-muted-foreground text-xs">
          Coverage held flat at ~100% from 06:00 UTC through report generation
          (16:00 UTC). Placed-rate <strong>2.2×</strong> from 3.48% → 7.74%. The
          remaining gap to "placed everything" is a sizing/filter problem, not
          an ingestion problem.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-medium text-lg">
          pXX drift on swisstony fill <code>size_usdc</code> (the metric{" "}
          <code>bet-sizer-v1</code> filters on)
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Percentile</TableHead>
              <TableHead className="text-right">
                Live (n={PXX_META.live_n.toLocaleString()},{" "}
                {PXX_META.live_window})
              </TableHead>
              <TableHead className="text-right">
                Baseline (n={PXX_META.baseline_n.toLocaleString()},{" "}
                {PXX_META.baseline_captured})
              </TableHead>
              <TableHead className="text-right">Drift</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PXX_DRIFT.map((r) => {
              const drift =
                r.baseline !== null && r.baseline > 0
                  ? Math.round(((r.live - r.baseline) / r.baseline) * 100)
                  : null;
              const isFilter = r.pct === 80;
              return (
                <TableRow key={r.pct}>
                  <TableCell>
                    p{r.pct}
                    {isFilter ? " (active filter)" : ""}
                  </TableCell>
                  <TableCell className="text-right">{fmtUsd(r.live)}</TableCell>
                  <TableCell className="text-right">
                    {r.baseline !== null ? (
                      fmtUsd(r.baseline, 0)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {drift !== null ? (
                      <span className="text-destructive">{drift}%</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="mt-2 text-muted-foreground text-xs">
          Live distribution is computed against{" "}
          <code>poly_trader_fills.size_usdc</code> for swisstony over the last
          48h — the same shape <code>bet-sizer-v1</code> filters against.
          Baseline percentiles are frozen in{" "}
          <code>
            nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts
          </code>{" "}
          (<code>TOP_TARGET_SIZE_SNAPSHOTS</code>, captured 2026-05-03 from a
          1085-fill sample). Every comparable percentile drifted{" "}
          <strong>−73% to −80%</strong>. The most likely explanation is that the
          baseline was itself captured while bug.5032 was silently dropping ~76%
          of swisstony's fills — the surviving 1085 was biased toward the
          largest recent fills, so the snapshot percentiles are inflated by the
          same factor we just fixed. <code>bet-sizer-v1</code> needs a re-snap
          against the now-complete pipeline.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-medium text-lg">
          Error histogram (last 1d, all markets)
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ERROR_BUCKETS_1D.map((b) => (
              <TableRow key={b.reason}>
                <TableCell>
                  <code>{b.reason}</code>
                </TableCell>
                <TableCell className="text-right">{b.n}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-2 text-muted-foreground text-xs">
          100% of 24h errors are <code>placement_failed</code>. The pre-fix
          report (05-06) split this into <code>cap_exceeded_per_order</code>{" "}
          (259), <code>insufficient_balance</code> (39),{" "}
          <code>below_min_order_size</code> (11). The new histogram collapses
          everything under <code>placement_failed</code> — a finer breakdown
          requires reading the decision <code>raw</code> column or Loki.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-medium text-lg">
          Top 18 leaks — swisstony won, we lost
        </h2>
        <div className="overflow-x-auto">
          <Table>
            <TableCaption>
              Sorted by their_pnl_usdc desc. Rows with{" "}
              <code>target_fills_1d=0</code> are <strong>carry</strong> —
              positions opened pre-window where the price moved in their favor;
              not fresh alpha. Rows with non-zero fills mix pre/post-fix
              activity at the 05:19 UTC cutover.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Market</TableHead>
                <TableHead className="text-right">Their P/L</TableHead>
                <TableHead className="text-right">Our P/L</TableHead>
                <TableHead className="text-right">Our cost</TableHead>
                <TableHead className="text-right">Size×</TableHead>
                <TableHead className="text-right">Target fills</TableHead>
                <TableHead className="text-right">Emit</TableHead>
                <TableHead className="text-right">Placed</TableHead>
                <TableHead className="text-right">Err</TableHead>
                <TableHead className="text-right">Skip</TableHead>
                <TableHead>Top skip</TableHead>
                <TableHead>Top error</TableHead>
                <TableHead>Diagnosis</TableHead>
                <TableHead>Loki</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((r) => {
                const link = pmLink(r.event_slug);
                const emitted = r.target_fills_1d - r.never_emitted;
                return (
                  <TableRow key={r.condition_id}>
                    <TableCell className="max-w-xs">
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {r.title}
                        </a>
                      ) : (
                        r.title
                      )}
                      <div className="text-muted-foreground text-xs">
                        <code>{r.condition_id.slice(0, 10)}…</code>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-success">
                      {fmtUsd(r.their_pnl_usdc, 0)}
                    </TableCell>
                    <TableCell className="text-right text-destructive">
                      {fmtUsd(r.our_pnl_usdc)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtUsd(r.our_cost_usdc)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.size_x !== null ? `${r.size_x}×` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.target_fills_1d}
                    </TableCell>
                    <TableCell className="text-right">
                      {emitted}/{r.target_fills_1d}
                    </TableCell>
                    <TableCell className="text-right">{r.placed}</TableCell>
                    <TableCell className="text-right">{r.errors}</TableCell>
                    <TableCell className="text-right">{r.skipped}</TableCell>
                    <TableCell>
                      {r.top_skip_reason ? (
                        <code>{r.top_skip_reason}</code>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {r.top_error_reason ? (
                        <code>{r.top_error_reason}</code>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="max-w-md text-xs">
                      {r.diagnosis}
                    </TableCell>
                    <TableCell className="text-xs">
                      <code className="break-all">
                        {lokiTemplate(r.condition_id)}
                      </code>
                    </TableCell>
                    <TableCell className="max-w-xs text-muted-foreground text-xs">
                      {r.notes || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="text-muted-foreground text-xs">
        <p>
          Decision-pipeline outcomes are taken from{" "}
          <code>poly_copy_trade_decisions</code> joined to swisstony fills by
          <code>fill_id = native_id</code>. <code>Emit</code> = decisions
          actually emitted by the mirror coordinator; the rest never reached the
          decision stage. <code>placed</code> aggregates <code>placed/ok</code>,{" "}
          <code>placed/layer_scale_in</code>, <code>placed/hedge_followup</code>
          . cashPnl pulled from <code>raw-&gt;&gt;&apos;cashPnl&apos;</code> on
          the latest <code>poly_trader_position_snapshots</code> row per
          (wallet, condition).
        </p>
      </section>
    </div>
  );
}

function Card({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone?: "good" | "bad";
}) {
  let toneCls = "";
  if (tone === "good") toneCls = "text-success";
  else if (tone === "bad") toneCls = "text-destructive";
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </div>
      <div className={`mt-1 font-semibold text-xl ${toneCls}`}>{value}</div>
    </div>
  );
}
