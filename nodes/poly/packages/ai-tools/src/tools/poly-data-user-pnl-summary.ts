// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-ai-tools/tools/poly-data-user-pnl-summary`
 * Purpose: AI tool — the canonical wallet snapshot. Returns a 12-cell sparkline +
 *   curve metrics + chr.poly-wallet-research numerical hard-filter verdict + score
 *   + confidence for one Polymarket proxy-wallet, in a single tool call. Caches
 *   results to the knowledge store with a 24h TTL so re-asking about the same
 *   wallet within a day costs zero upstream calls.
 * Scope: Read-modify-write on the curve summary. Fetches user-pnl-api via
 *   PolyDataCapability; reads + writes via KnowledgeCapability. Does not place
 *   trades, does not load env.
 * Invariants:
 *   - TOOL_ID_NAMESPACED, USER_PARAM_IS_PROXY_WALLET, REDACTION_ALLOWLIST.
 *   - EFFECT_STATE_CHANGE: the cache write upserts a knowledge-store row on every cache miss; this is by-design idempotent (same wallet → same id) but is still a state change for policy purposes.
 *   - DETERMINISTIC_FOR_FIXED_NOW: pure modulo the upstream fetch + the `now` clock; cache replays are fully deterministic.
 * Side-effects: IO (PolyDataCapability.getUserPnl + KnowledgeCapability.get/write)
 * Links: work/charters/POLY_WALLET_RESEARCH.md, work/items/task.0422.poly-data-user-pnl-summary-tool.md, docs/research/poly-wallet-methodology-self-review.md
 * @public
 */

import { z } from "zod";

import { summarize } from "../analysis/pnl-curve-metrics";
import type { PolyDataCapability } from "../capabilities/poly-data";
import type {
  BoundTool,
  KnowledgeCapability,
  ToolContract,
  ToolImplementation,
} from "@cogni/ai-tools";

const PolyAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be 0x-prefixed 40-hex proxy-wallet");

const KNOWLEDGE_DOMAIN = "poly-wallet-research" as const;
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h

export const PolyDataUserPnlSummaryInputSchema = z.object({
  user: PolyAddressSchema.describe(
    "Polymarket proxy-wallet (Safe) address (40-hex). Passing an EOA instead of a Safe-proxy will validate but the upstream user-pnl curve will be empty, yielding `degenerate=true` with `totalPnl=0`."
  ),
  forceRefresh: z
    .boolean()
    .optional()
    .describe(
      "Skip the 24h knowledge-store cache and re-fetch from upstream. Default: false. Use sparingly — every refresh hits the public Polymarket Data API rate budget."
    ),
});
export type PolyDataUserPnlSummaryInput = z.infer<
  typeof PolyDataUserPnlSummaryInputSchema
>;

const PnlCurveMetricsSchema = z.object({
  n: z.number().int().nonnegative(),
  monthsActive: z.number(),
  totalPnl: z.number(),
  peakPnl: z.number(),
  maxDdUsd: z.number(),
  maxDdPctOfPeak: z.number(),
  slope: z.number(),
  slopeR2: z.number(),
  slopeSign: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
  daysSinceLastChange: z.number(),
  longestUpStreak: z.number().int().nonnegative(),
  dailyPositiveFraction: z.number(),
  degenerate: z.boolean(),
});

const CharterVerdictSchema = z.object({
  passed: z.boolean(),
  reasons: z.array(z.string()),
  score: z.number(),
  confidence: z.number(),
});

export const PolyDataUserPnlSummaryOutputSchema = z.object({
  user: z.string(),
  /** 12-cell Unicode-block sparkline; "" if curve is degenerate. */
  sparkline12: z.string(),
  metrics: PnlCurveMetricsSchema,
  /** Numerical hard filters (H1/H3/H4 + slope sign). H2/H5/H7/H8 still need other data sources. */
  verdict: CharterVerdictSchema,
  /** ISO-8601 timestamp when this summary was last computed (cached or fresh). */
  refreshedAt: z.string(),
  /** True when this response came from the knowledge-store cache. */
  fromCache: z.boolean(),
  /** Charter version used to derive `verdict`. */
  charterVersion: z.string(),
});
export type PolyDataUserPnlSummaryOutput = z.infer<
  typeof PolyDataUserPnlSummaryOutputSchema
>;
export type PolyDataUserPnlSummaryRedacted = PolyDataUserPnlSummaryOutput;

export const POLY_DATA_USER_PNL_SUMMARY_NAME =
  "core__poly_data_user_pnl_summary" as const;

const CHARTER_VERSION = "chr.poly-wallet-research@2026-04-28" as const;

export const polyDataUserPnlSummaryContract: ToolContract<
  typeof POLY_DATA_USER_PNL_SUMMARY_NAME,
  PolyDataUserPnlSummaryInput,
  PolyDataUserPnlSummaryOutput,
  PolyDataUserPnlSummaryRedacted
> = {
  name: POLY_DATA_USER_PNL_SUMMARY_NAME,
  description:
    "The canonical at-a-glance wallet snapshot for copy-trade target screening. " +
    "Returns a 12-cell Unicode sparkline + curve metrics + chr.poly-wallet-research " +
    "hard-filter verdict + score + confidence for one Polymarket proxy-wallet. " +
    "Cached 24h in the knowledge store — set `forceRefresh: true` to bypass. " +
    "IMPORTANT: `verdict.passed` only checks the numerical hard filters (H1/H3/H4 + " +
    "slope sign); category (H5) and bot-vs-bot (H8) gates still require " +
    "`core__poly_data_activity` and a separate decision step.",
  effect: "state_change",
  inputSchema: PolyDataUserPnlSummaryInputSchema,
  outputSchema: PolyDataUserPnlSummaryOutputSchema,
  redact: (out) => out,
  allowlist: [
    "user",
    "sparkline12",
    "metrics",
    "verdict",
    "refreshedAt",
    "fromCache",
    "charterVersion",
  ] as const,
};

export interface PolyDataUserPnlSummaryDeps {
  polyDataCapability: PolyDataCapability;
  knowledgeCapability: KnowledgeCapability;
  /** Override clock for replay-determinism in tests. Returns unix seconds. */
  now?: () => number;
}

function cacheId(user: string): string {
  return `poly-wallet-summary:${user.toLowerCase()}`;
}

export function createPolyDataUserPnlSummaryImplementation(
  deps: PolyDataUserPnlSummaryDeps
): ToolImplementation<
  PolyDataUserPnlSummaryInput,
  PolyDataUserPnlSummaryOutput
> {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  return {
    execute: async (input) => {
      const user = input.user.toLowerCase();
      const id = cacheId(user);
      const nowSec = now();

      // 1. Cache lookup
      if (!input.forceRefresh) {
        const cached = await deps.knowledgeCapability.get(id);
        if (cached) {
          try {
            const parsed = JSON.parse(cached.content) as Omit<
              PolyDataUserPnlSummaryOutput,
              "fromCache"
            >;
            const cachedAtSec = Math.floor(
              new Date(parsed.refreshedAt).getTime() / 1000
            );
            if (
              Number.isFinite(cachedAtSec) &&
              nowSec - cachedAtSec < CACHE_TTL_SECONDS
            ) {
              return { ...parsed, fromCache: true };
            }
          } catch {
            // Corrupt cache row — fall through to re-fetch.
          }
        }
      }

      // 2. Fetch upstream curve
      const curve = await deps.polyDataCapability.getUserPnl({
        user,
        interval: "all",
        fidelity: "1d",
      });

      // 3. Compute summary (pure)
      const summary = summarize(curve.points, nowSec);

      const output: PolyDataUserPnlSummaryOutput = {
        user,
        sparkline12: summary.sparkline12,
        metrics: summary.metrics,
        verdict: {
          passed: summary.verdict.passed,
          reasons: [...summary.verdict.reasons],
          score: summary.verdict.score,
          confidence: summary.verdict.confidence,
        },
        refreshedAt: summary.computedAt,
        fromCache: false,
        charterVersion: CHARTER_VERSION,
      };

      // 4. Persist to knowledge store. We swallow write failures — the result is
      // still useful even if caching breaks (e.g. read-only role, store outage).
      try {
        const title = summary.verdict.passed
          ? `Wallet ${user} — PASSED (score ${summary.verdict.score.toFixed(2)})`
          : `Wallet ${user} — FAILED (${summary.verdict.reasons.join("; ")})`;
        await deps.knowledgeCapability.write({
          id,
          domain: KNOWLEDGE_DOMAIN,
          title,
          content: JSON.stringify(output),
          sourceType: "derived",
          entityId: user,
          confidencePct: Math.round(summary.verdict.confidence * 100),
          sourceRef: "user-pnl-api.polymarket.com/user-pnl",
          tags: [
            "poly-wallet-summary",
            CHARTER_VERSION,
            summary.verdict.passed ? "verdict-passed" : "verdict-failed",
          ],
        });
      } catch {
        // intentional swallow
      }

      return output;
    },
  };
}

/**
 * Stub for non-poly nodes / TOOL_BINDING_REQUIRED satisfaction. Returns a
 * degenerate response so other nodes never accidentally hit the upstream API
 * when this tool is bound but unused.
 */
export const polyDataUserPnlSummaryStubImplementation: ToolImplementation<
  PolyDataUserPnlSummaryInput,
  PolyDataUserPnlSummaryOutput
> = {
  execute: async (input) => ({
    user: input.user.toLowerCase(),
    sparkline12: "",
    metrics: {
      n: 0,
      monthsActive: 0,
      totalPnl: 0,
      peakPnl: 0,
      maxDdUsd: 0,
      maxDdPctOfPeak: 0,
      slope: 0,
      slopeR2: 0,
      slopeSign: 0,
      daysSinceLastChange: 0,
      longestUpStreak: 0,
      dailyPositiveFraction: 0,
      degenerate: true,
    },
    verdict: {
      passed: false,
      reasons: ["stub-implementation"],
      score: 0,
      confidence: 0,
    },
    refreshedAt: new Date(0).toISOString(),
    fromCache: false,
    charterVersion: CHARTER_VERSION,
  }),
};

export const polyDataUserPnlSummaryBoundTool: BoundTool<
  typeof POLY_DATA_USER_PNL_SUMMARY_NAME,
  PolyDataUserPnlSummaryInput,
  PolyDataUserPnlSummaryOutput,
  PolyDataUserPnlSummaryRedacted
> = {
  contract: polyDataUserPnlSummaryContract,
  implementation: polyDataUserPnlSummaryStubImplementation,
};
