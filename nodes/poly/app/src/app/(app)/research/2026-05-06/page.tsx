// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/2026-05-06/page`
 * Purpose: Static dated alpha-leak report — markets where swisstony made money
 *          and we lost over the trailing 1d window ending 2026-05-06. Data is
 *          a frozen snapshot from `poly_trader_position_snapshots` /
 *          `poly_trader_fills` / `poly_copy_trade_decisions` /
 *          `poly_copy_trade_fills` (prod). Each row is annotated with the
 *          decision-pipeline outcome histogram so the next agent can pick up
 *          a market and root-cause it from logs without re-querying.
 * Scope: Server component, auth-gated. Hardcoded data; no DB calls. Replace
 *        with a dated successor when the next report runs.
 * Side-effects: IO (auth check)
 * Links:
 *   - .claude/skills/data-research/recipes/alpha-leak-debug.md (taxonomy + recipes)
 *   - .context/alpha-leak-2d-prod.md (predecessor 2d aggregate)
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

const REPORT_DATE = "2026-05-06";
const WINDOW = "trailing 24h";
const TARGET_LABEL = "swisstony";
const OUR_LABEL = "Tenant trading wallet";

const SUMMARY = {
  target_fills_1d: 18686,
  placed: 591, // 399 ok + 164 layer_scale_in + 28 hedge_followup
  placed_ok: 399,
  errors: 284,
  skipped: 3277,
  never_emitted: 14247,
  leak_markets: 35, // markets where swisstony pnl > 0 and ours < 0 in last 1d
  swisstony_gain_on_leak_markets_usdc: 65_278,
  our_loss_on_leak_markets_usdc: -83.72,
} as const;

const ERROR_BUCKETS_1D: ReadonlyArray<{ reason: string; n: number }> = [
  { reason: "cap_exceeded_per_order", n: 259 },
  { reason: "insufficient_balance", n: 39 },
  { reason: "below_min_order_size", n: 11 },
];

type MarketRow = {
  condition_id: string;
  title: string;
  event_slug: string | null;
  their_pnl_usdc: number;
  our_pnl_usdc: number;
  our_cost_usdc: number;
  their_cost_usdc: number;
  size_x: number;
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
      "0x18c53552e94bdadf349ee5e135e9f424711f0fa6bcdc85969159ccca4b864c3d",
    title: "Bayern vs PSG: O/U 3.5",
    event_slug: "ucl-bay-psg-2026-05-06-more-markets",
    their_pnl_usdc: 23619,
    our_pnl_usdc: -3.94,
    our_cost_usdc: 3.94,
    their_cost_usdc: 18369,
    size_x: 4658,
    target_fills_1d: 282,
    never_emitted: 226,
    placed: 2,
    errors: 48,
    skipped: 6,
    top_skip_reason: "below_target_percentile",
    top_error_reason: "placement_failed",
    diagnosis:
      "Coverage gap dominant (226/282 swisstony fills never emitted a decision). 48 placement errors on top — likely cap_exceeded_per_order on the few we did try. Big swisstony win, our exposure was effectively zero.",
    notes: "",
  },
  {
    condition_id:
      "0x05c61ab4275ae67d8b05c3593ee70e740fc0e757cfa2e41d522b7c9bda685692",
    title: "Internazionali BNL d'Italia: Zhang vs Altmaier",
    event_slug: "atp-zhang-altmaie-2026-05-06",
    their_pnl_usdc: 4209,
    our_pnl_usdc: -6.5,
    our_cost_usdc: 11.53,
    their_cost_usdc: 9513,
    size_x: 825,
    target_fills_1d: 103,
    never_emitted: 63,
    placed: 5,
    errors: 0,
    skipped: 35,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: null,
    diagnosis:
      "Coverage gap + size-cap. 63 fills never emitted; 35 skipped because our resulting position would have been below threshold. We placed 5 micro-orders; their 825x size means we captured ~0.1% of edge.",
    notes: "",
  },
  {
    condition_id:
      "0xd62c6d741c4acd2f4edabe33fad35c98e258dfc88ee1a5f11e9df3b2208ff09d",
    title: "Internazionali BNL d'Italia: Pigato vs Grant",
    event_slug: "wta-pigato-grant-2026-05-05",
    their_pnl_usdc: 3943,
    our_pnl_usdc: -1.15,
    our_cost_usdc: 6.68,
    their_cost_usdc: 4476,
    size_x: 670,
    target_fills_1d: 44,
    never_emitted: 29,
    placed: 2,
    errors: 0,
    skipped: 13,
    top_skip_reason: "below_target_percentile",
    top_error_reason: null,
    diagnosis:
      "29/44 never_emitted — mirror coordinator did not even consider the majority of swisstony's fills here. 13 below_target_percentile = swisstony's bets fell below our pXX cutoff (filter staleness candidate).",
    notes: "",
  },
  {
    condition_id:
      "0xe6b9d547786ade247dba78e12c650c766fd6347c665d671ee8625c7ee0882783",
    title: "Will Kyōto Sanga FC win on 2026-05-06?",
    event_slug: "j1100-avi-kyo-2026-05-06",
    their_pnl_usdc: 3760,
    our_pnl_usdc: -1.22,
    our_cost_usdc: 6.99,
    their_cost_usdc: 3064,
    size_x: 438,
    target_fills_1d: 43,
    never_emitted: 38,
    placed: 0,
    errors: 0,
    skipped: 5,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: null,
    diagnosis:
      "Pure coverage gap. 38/43 never_emitted; 0 placed. We have a $7 position despite swisstony riding $3k cost basis to a $3.7k win.",
    notes: "",
  },
  {
    condition_id:
      "0xc50831975e60b6665a0c4062af1d08ceeaf968a69b38978bf57dae0e90dcdfa0",
    title: "Kawasaki Frontale vs. Tōkyō Verdy: O/U 1.5",
    event_slug: "j1100-kaw-ver-2026-05-06-more-markets",
    their_pnl_usdc: 3397,
    our_pnl_usdc: -3.51,
    our_cost_usdc: 3.51,
    their_cost_usdc: 6794,
    size_x: 1935,
    target_fills_1d: 77,
    never_emitted: 57,
    placed: 2,
    errors: 0,
    skipped: 18,
    top_skip_reason: "position_cap_reached",
    top_error_reason: null,
    diagnosis:
      "Coverage gap + position cap. 18 skipped because we hit our per-position cap. Even when the mirror did emit, sizing topped out fast at 1935× smaller than swisstony.",
    notes: "",
  },
  {
    condition_id:
      "0x3f7126d417a6638eb93e789ee95a8f6464850de51735239f9870aa50a9078d2b",
    title: "Internazionali BNL d'Italia: Pliskova vs Bouzas Maneiro",
    event_slug: "wta-pliskov-maneiro-2026-05-05",
    their_pnl_usdc: 3085,
    our_pnl_usdc: -2.49,
    our_cost_usdc: 2.49,
    their_cost_usdc: 9235,
    size_x: 3707,
    target_fills_1d: 65,
    never_emitted: 39,
    placed: 1,
    errors: 6,
    skipped: 19,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: "placement_failed",
    diagnosis:
      "Coverage gap + 6 placement errors (likely cap_exceeded_per_order — see global error histogram). One placed fill at $2.49 cost basis vs swisstony's $9k.",
    notes: "",
  },
  {
    condition_id:
      "0x27c74db90b4474968cbdc0f390487fb5b917c112fbc8582321ac34c488eef4a9",
    title: "76ers vs. Knicks: O/U 215.5",
    event_slug: "nba-phi-nyk-2026-05-06",
    their_pnl_usdc: 2602,
    our_pnl_usdc: -1.57,
    our_cost_usdc: 8.12,
    their_cost_usdc: 1765,
    size_x: 217,
    target_fills_1d: 28,
    never_emitted: 13,
    placed: 2,
    errors: 0,
    skipped: 13,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: null,
    diagnosis:
      "Most-evenly-sized leak in the table (217×). Half the fills emitted; half skipped on followup_position_too_small. Tuning followup threshold here would directly capture more.",
    notes: "",
  },
  {
    condition_id:
      "0x87c3405568fdeaf6f7e7e6b396212b4ce8637e3e57f51308effe50224a1b889a",
    title: "Will Cerezo Ōsaka win on 2026-05-06?",
    event_slug: "j1100-ssp-cer-2026-05-06",
    their_pnl_usdc: 2401,
    our_pnl_usdc: -1.44,
    our_cost_usdc: 8.07,
    their_cost_usdc: 4627,
    size_x: 573,
    target_fills_1d: 113,
    never_emitted: 81,
    placed: 2,
    errors: 0,
    skipped: 30,
    top_skip_reason: "below_target_percentile",
    top_error_reason: null,
    diagnosis:
      "30 skipped as below_target_percentile — direct evidence the hardcoded swisstony pXX in bet-sizer-v1 (captured 2026-05-03) is filtering bets that swisstony actively placed. Pull Recipe 5.",
    notes: "",
  },
  {
    condition_id:
      "0x137a07a40c862c48fa20e4bf0903615799188d89173bc6a02ef8f36908f75c60",
    title: "Kashiwa Reysol vs. Urawa Red Diamonds: O/U 2.5",
    event_slug: "j1100-rey-ura-2026-05-06-more-markets",
    their_pnl_usdc: 2242,
    our_pnl_usdc: -0.95,
    our_cost_usdc: 8.84,
    their_cost_usdc: 6280,
    size_x: 710,
    target_fills_1d: 85,
    never_emitted: 65,
    placed: 2,
    errors: 0,
    skipped: 18,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: null,
    diagnosis:
      "Coverage gap. 65/85 fills never_emitted. The 18 followup_position_too_small skips suggest our base entry was so small that follow-ups rounded to nothing.",
    notes: "",
  },
  {
    condition_id:
      "0x168e563b2d4c7b1f468a99b54ea7449119ed44b9919b3e54941b2dbc316af6b6",
    title: "Albirex Niigata vs. Tokushima Vortis: O/U 2.5",
    event_slug: "j2100-alb-tok-2026-05-06-more-markets",
    their_pnl_usdc: 1731,
    our_pnl_usdc: -2.7,
    our_cost_usdc: 2.7,
    their_cost_usdc: 3319,
    size_x: 1227,
    target_fills_1d: 33,
    never_emitted: 33,
    placed: 0,
    errors: 0,
    skipped: 0,
    top_skip_reason: null,
    top_error_reason: null,
    diagnosis:
      "100% never_emitted (33/33). The mirror pipeline saw zero of swisstony's fills here as candidates. High-priority debug — was the wallet-watch even subscribed to this market?",
    notes: "",
  },
  {
    condition_id:
      "0x3d1c1d96948fe74dd5074638764492911ae0a05448b827f9f17d12d6a4cbae22",
    title: "Will Tōkyō Verdy win on 2026-05-06?",
    event_slug: "j1100-kaw-ver-2026-05-06",
    their_pnl_usdc: 1686,
    our_pnl_usdc: -3.23,
    our_cost_usdc: 3.23,
    their_cost_usdc: 8363,
    size_x: 2586,
    target_fills_1d: 104,
    never_emitted: 70,
    placed: 2,
    errors: 2,
    skipped: 30,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: "placement_failed",
    diagnosis:
      "Coverage gap + sized too small to follow up. 2 placement errors on a 104-fill stream where swisstony made $1.7k.",
    notes: "",
  },
  {
    condition_id:
      "0x2022af0bd69048df509824792af58d31355daace3725c3cf0471a04430c92ca9",
    title: "Cincinnati Reds vs. Chicago Cubs",
    event_slug: "mlb-cin-chc-2026-05-06",
    their_pnl_usdc: 1518,
    our_pnl_usdc: -5.71,
    our_cost_usdc: 25.34,
    their_cost_usdc: 4487,
    size_x: 177,
    target_fills_1d: 53,
    never_emitted: 46,
    placed: 4,
    errors: 0,
    skipped: 3,
    top_skip_reason: "already_resting",
    top_error_reason: null,
    diagnosis:
      "Best-sized row (177×) and highest absolute cash loss in the leak set ($-5.71). Most fills (46) never_emitted; the 3 skipped were already_resting (we already had a passive order at price).",
    notes: "",
  },
  {
    condition_id:
      "0xc2e60b4140636c41d4889f4892b023e2af432164e5380bacc8c4aa9f3ac79ada",
    title: "Jiujiang: Watson vs Okamura",
    event_slug: "wta-watson-okamura-2026-05-06",
    their_pnl_usdc: 1464,
    our_pnl_usdc: -0.94,
    our_cost_usdc: 7.89,
    their_cost_usdc: 19801,
    size_x: 2510,
    target_fills_1d: 41,
    never_emitted: 33,
    placed: 1,
    errors: 0,
    skipped: 7,
    top_skip_reason: "below_target_percentile",
    top_error_reason: null,
    diagnosis:
      "Coverage gap + filter. 33 never_emitted; 7 below_target_percentile. swisstony cost basis $19.8k vs our $7.89 — extreme size asymmetry.",
    notes: "",
  },
  {
    condition_id:
      "0x62be9a3233c544786b2bd1de23864614fa37d1a33a0ac9a21b5a604cb5e58776",
    title: "Internazionali BNL d'Italia: Vukic vs Kypson",
    event_slug: "atp-vukic-kypson-2026-05-06",
    their_pnl_usdc: 1438,
    our_pnl_usdc: -2.72,
    our_cost_usdc: 19.46,
    their_cost_usdc: 2958,
    size_x: 152,
    target_fills_1d: 73,
    never_emitted: 35,
    placed: 8,
    errors: 2,
    skipped: 28,
    top_skip_reason: "already_resting",
    top_error_reason: "placement_failed",
    diagnosis:
      "Best mirror coverage of the leak set: 8 placed, only 35 never_emitted out of 73 target fills, 152× size ratio. Still leaked. 28 already_resting suggests our resting orders weren't getting refreshed when swisstony moved.",
    notes: "",
  },
  {
    condition_id:
      "0xc771536cd575abf4aed709061b8014f2830fad62d70b92389b1c28d417daaecb",
    title: "Internazionali BNL d'Italia: Muller vs van de Zandschulp",
    event_slug: "atp-muller-zandsch-2026-05-06",
    their_pnl_usdc: 994,
    our_pnl_usdc: -2.31,
    our_cost_usdc: 2.31,
    their_cost_usdc: 3832,
    size_x: 1662,
    target_fills_1d: 60,
    never_emitted: 53,
    placed: 1,
    errors: 0,
    skipped: 6,
    top_skip_reason: "followup_position_too_small",
    top_error_reason: null,
    diagnosis:
      "Coverage gap. 53/60 never_emitted. One placed; followups all skipped as too small. Pattern matches the rest: we mirror once, never scale in.",
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
          and we (<code>{OUR_LABEL}</code>) lost. Frozen snapshot — replace with
          a successor when re-run. Source data: prod{" "}
          <code>poly_trader_position_snapshots</code> (cashPnl from{" "}
          <code>raw-&gt;&gt;&apos;cashPnl&apos;</code>) joined to{" "}
          <code>poly_copy_trade_decisions</code>. Recipe pack:{" "}
          <code>.claude/skills/data-research/recipes/alpha-leak-debug.md</code>.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card
          title="swisstony fills (1d)"
          value={SUMMARY.target_fills_1d.toLocaleString()}
        />
        <Card
          title="never_emitted"
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
      </section>

      <section>
        <h2 className="mb-2 font-medium text-lg">
          Top 15 leaks — swisstony won, we lost
        </h2>
        <div className="overflow-x-auto">
          <Table>
            <TableCaption>
              Sorted by their_pnl_usdc desc. Diagnosis is preliminary; Notes
              column is left blank for human / agent root-cause work.
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
                    <TableCell className="text-right">{r.size_x}×</TableCell>
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
          Decision-pipeline outcomes are taken from
          <code>poly_copy_trade_decisions</code> joined to swisstony fills by
          <code>fill_id = native_id</code>. <code>Emit</code> = decisions
          actually emitted by the mirror coordinator; the rest never reached the
          decision stage. <code>placed</code> aggregates <code>placed/ok</code>,{" "}
          <code>placed/layer_scale_in</code>, <code>placed/hedge_followup</code>
          .
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
