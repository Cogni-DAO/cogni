// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/view`
 * Purpose: Static synthesis of spike.0323 — Polymarket copy-trade candidate identification.
 * Scope: Presentational only. Zero data fetching. Zero business logic.
 * Invariants: All content is static; source of truth is docs/research/polymarket-copy-trade-candidates.md.
 * Side-effects: none
 * Links: work/items/spike.0323.poly-copy-trade-candidate-identification.md, docs/research/polymarket-copy-trade-candidates.md
 * @public
 */

"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  FlaskConical,
  Minus,
  Shield,
  Sparkles,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
} from "@/components";
import {
  type WalletAnalysisData,
  WalletAnalysisView,
  WalletQuickJump,
} from "@/features/wallet-analysis";
import { cn } from "@/shared/util/cn";

/* ────────────────────────────────────────────────────────────────── */
/*  DATA — frozen synthesis of spike.0323                             */
/* ────────────────────────────────────────────────────────────────── */

/** BeefSlayer — the v0 primary target. Captured 2026-04-19 from Data-API + spike. */
const BEEF = {
  name: "BeefSlayer",
  wallet: "0x331bf91c132af9d921e1908ca0979363fc47193f",
  short: "0x331bf91c…47193f",
  category: "Weather — US city high-temp markets",
  stats: {
    resolved: 118,
    winRate: 78.0,
    roi: 27.3,
    pnl: "$5k",
    dd: 10.7,
    medianDur: "29 min",
  },
  // last 14d of trade counts from Data-API /trades?user=... (newest-first)
  daily: [
    { d: "Mon 04-06", n: 16 },
    { d: "Tue 04-07", n: 5 },
    { d: "Wed 04-08", n: 14 },
    { d: "Thu 04-09", n: 3 },
    { d: "Sat 04-11", n: 3 },
    { d: "Sun 04-12", n: 4 },
    { d: "Mon 04-13", n: 9 },
    { d: "Tue 04-14", n: 9 },
    { d: "Wed 04-15", n: 15 },
    { d: "Thu 04-16", n: 5 },
    { d: "Fri 04-17", n: 14 },
    { d: "Sat 04-18", n: 27 },
    { d: "Sun 04-19", n: 2 },
  ],
  last5: [
    {
      ts: "04-19 01:28Z",
      side: "BUY",
      size: "556",
      px: "0.009",
      mkt: "Atlanta high temp 64–65°F",
    },
    {
      ts: "04-19 01:27Z",
      side: "BUY",
      size: "307",
      px: "0.034",
      mkt: "Atlanta high temp 66–67°F",
    },
    {
      ts: "04-18 19:49Z",
      side: "BUY",
      size: "121",
      px: "0.118",
      mkt: "Atlanta high temp 82–83°F",
    },
    {
      ts: "04-18 18:52Z",
      side: "SELL",
      size: "2,534",
      px: "0.002",
      mkt: "NYC high temp 58–59°F",
    },
    {
      ts: "04-18 18:44Z",
      side: "SELL",
      size: "552",
      px: "0.099",
      mkt: "NYC high temp 58–59°F",
    },
  ],
  topMkts: [
    "NYC daily high",
    "Atlanta daily high",
    "Houston daily high",
    "Austin daily high",
  ],
  avg30d: 11,
} as const;

/** BeefSlayer in WalletAnalysisData shape — fed to the reusable WalletAnalysisView. */
const BEEF_ANALYSIS: WalletAnalysisData = {
  address: BEEF.wallet,
  identity: {
    name: BEEF.name,
    category: "Weather",
    isPrimaryTarget: true,
  },
  snapshot: {
    n: BEEF.stats.resolved,
    wr: BEEF.stats.winRate,
    roi: BEEF.stats.roi,
    pnl: BEEF.stats.pnl,
    dd: BEEF.stats.dd,
    medianDur: BEEF.stats.medianDur,
    avgPerDay: BEEF.avg30d,
    hypothesisMd:
      "Daily city high-temp markets are retail-dominant books priced against shallow weather-guessing. A disciplined user of public NOAA / ECMWF ensembles earns a persistent premium. BeefSlayer's 78% WR across 118 resolved positions with 10.7% max drawdown is the largest and cleanest sample in the entire 160-wallet screen.",
    category: BEEF.category,
  },
  trades: {
    last: BEEF.last5,
    dailyCounts: BEEF.daily,
    topMarkets: BEEF.topMkts,
  },
};

type Runner = {
  rank: number;
  wallet: string;
  name: string;
  category: string;
  n: number;
  wr: number;
  roi: number;
  pnl: string;
  dd: number;
  dur: string;
  why: string;
};

const RUNNERS: readonly Runner[] = [
  {
    rank: 2,
    wallet: "0x22e4248b…",
    name: "ProfessionalPunter",
    category: "tech",
    n: 37,
    wr: 83.8,
    roi: 97.4,
    pnl: "$148k",
    dd: 5.6,
    dur: "1.08h",
    why: "Best balanced tech wallet — high WR, shallow DD.",
  },
  {
    rank: 3,
    wallet: "0xc6dd7225…",
    name: "tourists",
    category: "tech",
    n: 14,
    wr: 85.7,
    roi: 47.9,
    pnl: "$193k",
    dd: 0,
    dur: "6 min",
    why: "Zero-DD precision. Small n; size conservatively.",
  },
  {
    rank: 4,
    wallet: "0xff30ac5b…",
    name: "aldynspeedruns",
    category: "finance",
    n: 72,
    wr: 63.9,
    roi: 50.8,
    pnl: "$109k",
    dd: 8.8,
    dur: "0.91h",
    why: "Diversifier away from tech/weather concentration.",
  },
] as const;

type Direction = "best" | "add" | "neutral" | "avoid";
type Category = {
  name: string;
  tagline: string;
  resolution: string;
  verdict: Direction;
  pros: readonly string[];
  cons: readonly string[];
};

const CATEGORIES: readonly Category[] = [
  {
    name: "Weather",
    tagline: "US city high-temp buckets. BeefSlayer's home turf.",
    resolution: "24h",
    verdict: "best",
    pros: [
      "Edge source is public: NOAA / ECMWF ensembles vs. retail book.",
      "Fast daily turnover — one cycle per city per day; capital recycles.",
      "$300–400k/day on a single top market; enough liquidity for $50 mirrors.",
      "Specialist with n=118 resolved and clean equity curve (BeefSlayer).",
    ],
    cons: [
      "Edge narrows when NOAA ensembles are stale or cities have volatile fronts.",
      "Small PnL per wallet ($5k for BeefSlayer) — realized-ROI beats realized-dollars.",
      "Bucket markets resolve in long tails of 0.5%–10% prices — slippage pinch possible.",
    ],
  },
  {
    name: "Tech",
    tagline: "Product launches, benchmark claims, crypto-adjacent corp events.",
    resolution: "hours–days",
    verdict: "best",
    pros: [
      "Cleanest equity curves observed in the 160-wallet v3 screen.",
      "Two survivors: ProfessionalPunter (WR 83.8%, DD 5.6%) and tourists (WR 85.7%, DD 0%).",
      "Retail-dominated books; sharps usually elsewhere.",
    ],
    cons: [
      "Low sample sizes (n=14 for tourists) — winners may regress.",
      "Narrow category — can't diversify within tech alone.",
      "Some overlap with insider-flagged geopolitics/finance markets — screen carefully.",
    ],
  },
  {
    name: "Finance",
    tagline: "Rates, jobless claims, macro-calendar markets.",
    resolution: "days",
    verdict: "add",
    pros: [
      "Single clean survivor (aldynspeedruns) — diversifies category risk.",
      "Slower cadence means less copy-latency pressure on the 30s poll.",
    ],
    cons: [
      "Polymarket is downstream of CME/SOFR futures for macro events.",
      "Fed / FOMC markets in particular show no wallet-level skill premium.",
      "Regulatory adjacency — keep far from CPI-leak-adjacent scenarios.",
    ],
  },
  {
    name: "Sports / Esports",
    tagline: "NBA/NFL/MLB, LoL, CS, Valorant, cricket IPL.",
    resolution: "hours–days",
    verdict: "neutral",
    pros: [
      "Retail-heavy books; thesis of informed edge on team-form / meta is real.",
      "Fast resolution (1–3h for esports BO3) — capital recycles.",
      "Appendix C esports picks (goodmateng, Mr.Ape) still elite on 30d slices.",
    ],
    cons: [
      "Reliability degraded on full resolution coverage (21% → 40%+): bossoskil1 WR fell from 60.9% → 50.5%, DD jumped to 53%.",
      "Pre-match entry windows are short — taker fills can bleed edge.",
      "Meta shifts (LoL/CS patches) can invalidate specialist edge overnight.",
    ],
  },
  {
    name: "Politics (elections)",
    tagline: "On-cycle races, primaries, long-dated outcomes.",
    resolution: "months",
    verdict: "neutral",
    pros: [
      "Thesis traders can win huge (Fredi9999 ~$85M in 2024).",
      "Liquidity is deep in high-salience windows.",
    ],
    cons: [
      "Thesis ≠ flow — not a repeatable copy-trade signal.",
      "Long holds tie up mirror capital.",
      "Off-cycle windows are dead calm.",
    ],
  },
  {
    name: "Crypto buckets (5-min BTC/ETH)",
    tagline: "Sub-block latency arb against Binance spot.",
    resolution: "minutes",
    verdict: "avoid",
    pros: [
      "Edge is real and large — JPMorgan101 runs +22.7% ROI at $3.7M volume.",
    ],
    cons: [
      "Fills resolve in the same block as Binance ticks.",
      "Our 30-second poll is 2–3 orders of magnitude too slow to participate.",
      "Copying means crossing the spread against a pro — guaranteed loss.",
    ],
  },
  {
    name: "Geopolitics · Celebrity · Reality TV",
    tagline: "Ceasefires, strike timing, Survivor/Bachelor, FDA, M&A, SCOTUS.",
    resolution: "days–weeks",
    verdict: "avoid",
    pros: ["Edge exists — but by definition it is inside information."],
    cons: [
      "Harvard 2026-03: flagged accounts won 69.9%, >60σ above chance, ~$143M anomalous profit.",
      "Active congressional probes (Schiff-Curtis, Torres) target exactly these categories.",
      "Palantir/TWG surveillance deal live on reality TV spoiler-leak markets.",
      "Copying = inheriting the regulatory tail risk of the wallet you mirror.",
    ],
  },
] as const;

type Avoid = { name: string; wallet: string; why: string };
const AVOIDS: readonly Avoid[] = [
  {
    name: "JPMorgan101",
    wallet: "0xb6d6e99d…",
    why: "BTC 5-min bucket latency arb. Uncopyable at 30s poll cadence.",
  },
  {
    name: "denizz",
    wallet: "0xbaa2bcb5…",
    why: "Iran ceasefire specialist — Harvard-flagged category.",
  },
  {
    name: "avenger",
    wallet: "0xd4f904ec…",
    why: "$2k volume, 10,177% ROI. Single lucky Elon-tweet bet.",
  },
  {
    name: "generic whales",
    wallet: "0x5d58e38c… · 0x64805429… · 0x9e9c8b08…",
    why: "$40M+ volume, near-zero ROI. Capital, not edge.",
  },
] as const;

/* ────────────────────────────────────────────────────────────────── */
/*  ATOMS                                                              */
/* ────────────────────────────────────────────────────────────────── */

function VerdictChip({ v }: { v: Direction }): ReactElement {
  if (v === "best")
    return (
      <Badge intent="default" size="sm" className="gap-1">
        <Sparkles className="size-3" /> Primary
      </Badge>
    );
  if (v === "add")
    return (
      <Badge
        intent="default"
        size="sm"
        className="gap-1 bg-success/15 text-success"
      >
        <ArrowUpRight className="size-3" /> Add
      </Badge>
    );
  if (v === "avoid")
    return (
      <Badge intent="destructive" size="sm" className="gap-1">
        <Ban className="size-3" /> Avoid
      </Badge>
    );
  return (
    <Badge intent="secondary" size="sm" className="gap-1">
      <Minus className="size-3" /> Neutral
    </Badge>
  );
}

function _StatBlock({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "warn";
  hint?: string;
}): ReactElement {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warn"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="flex flex-col gap-1 p-4">
      <span className="text-muted-foreground text-xs uppercase tracking-widest">
        {label}
      </span>
      <span
        className={cn(
          "font-mono font-semibold text-2xl tabular-nums leading-none",
          toneCls
        )}
      >
        {value}
      </span>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  VIEW                                                               */
/* ────────────────────────────────────────────────────────────────── */

export function ResearchView(): ReactElement {
  const _maxN = Math.max(...BEEF.daily.map((d) => d.n));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-14 px-5 py-10 md:px-8 md:py-14">
      {/* ─── MASTHEAD ─────────────────────────────── */}
      <header className="flex flex-col gap-5">
        <div className="flex items-center gap-3 text-muted-foreground text-xs uppercase tracking-widest">
          <FlaskConical className="size-3.5" />
          <span>Dossier · spike.0323</span>
          <span className="text-border">/</span>
          <span>2026-04-18</span>
          <span className="text-border">/</span>
          <span>confidence: medium</span>
        </div>
        <h1 className="font-serif font-thin text-5xl leading-none tracking-tight md:text-7xl">
          One wallet. <span className="italic">Four</span> categories.
          <span className="text-primary">.</span>
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground leading-relaxed">
          v0 mirrors <strong className="text-foreground">BeefSlayer</strong> — a
          weather-markets specialist. Three runners-up are on standby across
          tech &amp; finance. Everything else is either the no-fly zone or a
          trap.
        </p>
        <WalletQuickJump className="max-w-xl" />
      </header>

      {/* ─── §01 THE TARGET — BEEFSLAYER ─────────── */}
      <section className="flex flex-col gap-5">
        <SectionLabel
          kicker="§ 01 — The target"
          title="BeefSlayer, in brief."
        />
        <WalletAnalysisView
          data={BEEF_ANALYSIS}
          variant="page"
          size="hero"
          capturedAt="2026-04-19"
          rankBadge="01"
        />
      </section>

      {/* ─── §02 CATEGORIES ──────────────────────── */}
      <section className="flex flex-col gap-5">
        <SectionLabel
          kicker="§ 02 — The market map"
          title="Where edge is plausible, where it's a trap."
          sub="Every Polymarket category we looked at, ranked by whether it's worth a 30-second mirror poll."
        />
        <div className="flex flex-col gap-4">
          {CATEGORIES.map((c, i) => (
            <CategoryRow key={c.name} c={c} i={i} />
          ))}
        </div>
      </section>

      {/* ─── §03 RUNNER-UP ROSTER ────────────────── */}
      <section className="flex flex-col gap-5">
        <SectionLabel
          kicker="§ 03 — On the bench"
          title="Three runners-up, ready to promote."
          sub="Not mirrored today; short-listed if BeefSlayer's signal degrades."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {RUNNERS.map((r) => (
            <RunnerCard key={r.wallet} r={r} />
          ))}
        </div>
      </section>

      {/* ─── §04 AVOID ───────────────────────────── */}
      <section className="flex flex-col gap-5">
        <SectionLabel
          kicker="§ 04 — No-fly zone"
          title="Wallets and markets we deliberately will not mirror."
        />
        <div className="grid gap-3 md:grid-cols-2">
          {AVOIDS.map((w) => (
            <div
              key={w.name}
              className="flex gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
            >
              <Ban className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h4 className="font-semibold text-sm">{w.name}</h4>
                  <code className="truncate font-mono text-muted-foreground text-xs">
                    {w.wallet}
                  </code>
                </div>
                <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
                  {w.why}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3 rounded-lg border border-success/40 bg-success/5 p-4 text-sm">
          <Shield className="mt-0.5 size-4 shrink-0 text-success" />
          <p className="leading-relaxed">
            <strong className="font-semibold">Rule of thumb:</strong> before
            mirroring any new wallet, cross-check against the{" "}
            <a
              href="https://corpgov.law.harvard.edu/2026/03/25/from-iran-to-taylor-swift-informed-trading-in-prediction-markets/"
              className="text-primary underline-offset-2 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Harvard 2026 flagged-wallet dataset
            </a>{" "}
            (210,718 flagged (wallet, market) pairs). Single correctness gate,
            zero runtime cost.
          </p>
        </div>
      </section>

      {/* ─── FOOTER ──────────────────────────────── */}
      <footer className="flex flex-col gap-3">
        <Separator />
        <p className="text-muted-foreground text-xs leading-relaxed">
          Source of truth:{" "}
          <code className="font-mono">
            docs/research/polymarket-copy-trade-candidates.md
          </code>{" "}
          · spike{" "}
          <code className="font-mono">
            work/items/spike.0323.poly-copy-trade-candidate-identification.md
          </code>
          . Data captured 2026-04-19 via public Polymarket Data-API + CLOB.
          Freshness: re-screen quarterly.
        </p>
      </footer>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */

function CategoryRow({ c, i }: { c: Category; i: number }): ReactElement {
  const accent =
    c.verdict === "avoid"
      ? "border-l-destructive"
      : c.verdict === "best"
        ? "border-l-primary"
        : c.verdict === "add"
          ? "border-l-success"
          : "border-l-muted-foreground/30";
  return (
    <article
      className={cn(
        "overflow-hidden rounded-lg border border-border border-l-4 bg-card",
        accent
      )}
    >
      <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:gap-8">
        {/* index + name */}
        <div className="flex min-w-52 shrink-0 items-start gap-4">
          <span className="font-mono text-muted-foreground text-xs tabular-nums">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold font-serif text-xl leading-tight tracking-tight">
              {c.name}
            </h3>
            <span className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
              resolves in {c.resolution}
            </span>
            <div className="pt-1">
              <VerdictChip v={c.verdict} />
            </div>
          </div>
        </div>

        {/* tagline + pros/cons */}
        <div className="flex flex-1 flex-col gap-3">
          <p className="text-muted-foreground text-sm italic">{c.tagline}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <ul className="space-y-1.5">
              {c.pros.map((p) => (
                <li key={p} className="flex gap-2 text-sm leading-relaxed">
                  <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-success" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <ul className="space-y-1.5">
              {c.cons.map((p) => (
                <li
                  key={p}
                  className="flex gap-2 text-muted-foreground text-sm leading-relaxed"
                >
                  <ArrowDownRight className="mt-0.5 size-3.5 shrink-0 text-destructive/80" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </article>
  );
}

function RunnerCard({ r }: { r: Runner }): ReactElement {
  return (
    <Card className="relative overflow-hidden">
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 right-2 select-none font-black text-6xl text-muted-foreground/10 leading-none tracking-tighter"
      >
        {String(r.rank).padStart(2, "0")}
      </span>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Badge intent="secondary" size="sm" className="font-mono uppercase">
            {r.category}
          </Badge>
          <span className="text-muted-foreground text-xs tabular-nums">
            n={r.n}
          </span>
        </div>
        <CardTitle className="font-semibold font-serif text-xl leading-tight tracking-tight">
          {r.name}
        </CardTitle>
        <code className="font-mono text-muted-foreground text-xs">
          {r.wallet}
        </code>
      </CardHeader>
      <CardContent className="space-y-0 pt-0">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded border bg-border">
          <div className="flex flex-col gap-0.5 bg-card p-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              WR
            </span>
            <span className="font-mono font-semibold text-sm text-success tabular-nums">
              {r.wr.toFixed(1)}%
            </span>
          </div>
          <div className="flex flex-col gap-0.5 bg-card p-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              ROI
            </span>
            <span className="font-mono font-semibold text-sm text-success tabular-nums">
              +{r.roi.toFixed(1)}%
            </span>
          </div>
          <div className="flex flex-col gap-0.5 bg-card p-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              DD
            </span>
            <span
              className={cn(
                "font-mono font-semibold text-sm tabular-nums",
                r.dd <= 10 ? "text-success" : "text-destructive"
              )}
            >
              {r.dd.toFixed(1)}%
            </span>
          </div>
        </div>
        <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
          {r.why}
        </p>
      </CardContent>
    </Card>
  );
}

function SectionLabel({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub?: string;
}): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-primary text-xs uppercase tracking-widest">
        {kicker}
      </p>
      <h2 className="font-medium font-serif text-3xl leading-tight tracking-tight md:text-4xl">
        {title}
      </h2>
      {sub && (
        <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
          {sub}
        </p>
      )}
    </div>
  );
}
