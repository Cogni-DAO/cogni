// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/_components/category`
 * Purpose: v0 heuristic that maps a leaderboard wallet to a coarse category from its display name + wallet address. Real categorization (Dolt-stored, AI-authored) lands with task.0333.
 * Scope: Pure function. No I/O. Stable enum so the FacetedFilter values agree across renders.
 * Invariants: Always returns one of the WALLET_CATEGORIES strings; defaults to "Other" when nothing matches.
 * Side-effects: none
 * Links: work/items/task.0343.wallets-dashboard-page.md, work/items/task.0333.wallet-analyst-agent-and-dolt-store.md
 * @internal
 */

export const WALLET_CATEGORIES = [
  "Weather",
  "Tech",
  "Sports",
  "Esports",
  "Politics",
  "Crypto",
  "Other",
] as const;

export type WalletCategory = (typeof WALLET_CATEGORIES)[number];

const RULES: ReadonlyArray<{ pattern: RegExp; category: WalletCategory }> = [
  { pattern: /weather|temp|noaa|beefslayer/i, category: "Weather" },
  { pattern: /esport|csgo|valorant|league|lol|dota|sc2/i, category: "Esports" },
  {
    pattern: /\bnba\b|\bnfl\b|\bmlb\b|sport|football|soccer|hockey|tennis/i,
    category: "Sports",
  },
  { pattern: /elect|trump|biden|harris|polit/i, category: "Politics" },
  { pattern: /crypto|btc|eth|bitcoin|ethereum/i, category: "Crypto" },
  {
    pattern: /\btech\b|nvidia|apple|google|openai|claude|anthropic/i,
    category: "Tech",
  },
];

/** Coarse v0 category heuristic. Real labels arrive via task.0333 Dolt rows. */
export function inferWalletCategory(input: {
  userName?: string;
  proxyWallet?: string;
}): WalletCategory {
  const haystack = `${input.userName ?? ""} ${input.proxyWallet ?? ""}`;
  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }
  return "Other";
}
