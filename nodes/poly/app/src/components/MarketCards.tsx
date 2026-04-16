"use client";

import { motion } from "framer-motion";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

/* ─── Types ─────────────────────────────────────── */

interface MarketOutcome {
  label: string;
  probability: number;
  /** positive = up, negative = down */
  change24h: number;
}

interface Market {
  id: string;
  title: string;
  category: string;
  platform: "Polymarket" | "Kalshi";
  volume: string;
  outcomes: MarketOutcome[];
  /** ISO date string for market resolution */
  resolves: string;
}

/* ─── Mock data (will be replaced by API) ────────── */

const MOCK_MARKETS: Market[] = [
  {
    id: "1",
    title: "Fed cuts rates at June meeting?",
    category: "Economics",
    platform: "Kalshi",
    volume: "$4.2M",
    resolves: "2026-06-18",
    outcomes: [
      { label: "Yes", probability: 62, change24h: 4 },
      { label: "No", probability: 38, change24h: -4 },
    ],
  },
  {
    id: "2",
    title: "GPT-5 released before July 2026?",
    category: "Tech",
    platform: "Polymarket",
    volume: "$1.8M",
    resolves: "2026-07-01",
    outcomes: [
      { label: "Yes", probability: 34, change24h: -2 },
      { label: "No", probability: 66, change24h: 2 },
    ],
  },
  {
    id: "3",
    title: "Bitcoin above $150k by EOY?",
    category: "Crypto",
    platform: "Polymarket",
    volume: "$12.4M",
    resolves: "2026-12-31",
    outcomes: [
      { label: "Yes", probability: 28, change24h: 7 },
      { label: "No", probability: 72, change24h: -7 },
    ],
  },
  {
    id: "4",
    title: "Category 5 hurricane hits US in 2026?",
    category: "Climate",
    platform: "Kalshi",
    volume: "$890K",
    resolves: "2026-11-30",
    outcomes: [
      { label: "Yes", probability: 41, change24h: -1 },
      { label: "No", probability: 59, change24h: 1 },
    ],
  },
];

/* ─── Probability bar (Polymarket-style) ─────────── */

function ProbabilityBar({
  outcomes,
}: {
  outcomes: MarketOutcome[];
}): ReactElement {
  const yes = outcomes[0]!;
  const no = outcomes[1]!;

  return (
    <div className="flex gap-1.5">
      <div
        className="flex items-center justify-center rounded-md bg-up/15 py-2 font-mono text-up text-xs transition-all"
        style={{ width: `${yes.probability}%` }}
      >
        {yes.probability > 15 && (
          <span>
            Yes {yes.probability}
            <span className="opacity-60">c</span>
          </span>
        )}
      </div>
      <div
        className="flex items-center justify-center rounded-md bg-down/15 py-2 font-mono text-down text-xs transition-all"
        style={{ width: `${no.probability}%` }}
      >
        {no.probability > 15 && (
          <span>
            No {no.probability}
            <span className="opacity-60">c</span>
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Change badge ──────────────────────────────── */

function ChangeBadge({ change }: { change: number }): ReactElement {
  const isUp = change > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-mono text-xs ${
        isUp ? "text-up" : "text-down"
      }`}
    >
      {isUp ? (
        <TrendingUp className="size-3" />
      ) : (
        <TrendingDown className="size-3" />
      )}
      {isUp ? "+" : ""}
      {change}%
    </span>
  );
}

/* ─── Single market card ────────────────────────── */

function MarketCard({
  market,
  delay,
}: {
  market: Market;
  delay: number;
}): ReactElement {
  // Simulate subtle probability drift
  const [outcomes, setOutcomes] = useState(market.outcomes);

  useEffect(() => {
    const interval = setInterval(
      () => {
        setOutcomes((prev) => {
          const drift = Math.random() > 0.5 ? 1 : -1;
          const newYes = Math.max(
            1,
            Math.min(99, prev[0]!.probability + drift)
          );
          return [
            { ...prev[0]!, probability: newYes },
            { ...prev[1]!, probability: 100 - newYes },
          ];
        });
      },
      4000 + Math.random() * 3000
    );
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay }}
      className="rounded-lg border border-border/40 bg-card p-4 sm:p-5"
    >
      {/* Header row */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
              {market.category}
            </span>
            <span className="text-[10px] text-muted-foreground/50">
              {market.platform}
            </span>
          </div>
          <h3 className="font-semibold text-foreground text-sm leading-snug sm:text-base">
            {market.title}
          </h3>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-bold font-mono text-foreground text-lg tabular-nums sm:text-xl">
            {outcomes[0]!.probability}%
          </div>
          <ChangeBadge change={market.outcomes[0]!.change24h} />
        </div>
      </div>

      {/* Probability bar */}
      <ProbabilityBar outcomes={outcomes} />

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider">
          {market.volume} Vol.
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider">
          Resolves{" "}
          {new Date(market.resolves).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
    </motion.div>
  );
}

/* ─── Exported section ──────────────────────────── */

export function MarketCards(): ReactElement {
  return (
    <section id="markets" className="w-full bg-background py-20 md:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-12"
        >
          <span className="font-mono text-primary text-xs uppercase tracking-widest">
            Live coverage
          </span>
          <h2 className="mt-3 font-bold text-3xl tracking-tight sm:text-4xl">
            One bot. Every market.
          </h2>
          <p className="mt-3 max-w-lg text-muted-foreground">
            It goes where the signal is. Cross-platform research means you never
            miss a mispricing — regardless of where it surfaces.
          </p>
        </motion.div>

        {/* Category pills */}
        <div className="mb-6 flex flex-wrap gap-2">
          {["All", "Economics", "Tech", "Crypto", "Climate", "Politics"].map(
            (cat, i) => (
              <button
                key={cat}
                type="button"
                className={`rounded-full px-3 py-1 font-mono text-xs uppercase tracking-wider transition-colors ${
                  i === 0
                    ? "bg-primary/15 text-primary"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {cat}
              </button>
            )
          )}
        </div>

        {/* Market grid */}
        <div className="grid gap-4 sm:grid-cols-2">
          {MOCK_MARKETS.map((m, i) => (
            <MarketCard key={m.id} market={m} delay={i * 0.08} />
          ))}
        </div>
      </div>
    </section>
  );
}
