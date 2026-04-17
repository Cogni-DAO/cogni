/**
 * Module: `@cogni/poly-knowledge/seeds/poly`
 * Purpose: Prediction market domain knowledge seeds for the poly node.
 *   Real Polymarket strategy content — edge-finding, market structure, risk management.
 *   Each entry is sourced, confidence-scored, and tagged for retrieval.
 * Side-effects: none
 * @public
 */

import type { NewKnowledge } from "@cogni/knowledge-store";
import { CONFIDENCE } from "@cogni/ai-tools";

/** Base seeds inherited from node-template */
export { BASE_KNOWLEDGE_SEEDS } from "@cogni/node-template-knowledge";

/** Poly-specific prediction market knowledge seeds */
export const POLY_KNOWLEDGE_SEEDS: NewKnowledge[] = [
  // ── Edge-Finding ───────────────────────────────────────────────────────

  {
    id: "pm:edge:favorite-longshot-bias",
    domain: "prediction-market",
    title: "Favorite-longshot bias is the most proven edge in prediction markets",
    content:
      "Bettors systematically overprice longshots (< 15%) and underprice heavy favorites (> 85%). " +
      "This is the single most replicated finding in prediction market research, documented across " +
      "horse racing, sports betting, and political markets since Griffith (1949). On Polymarket, " +
      "look for markets where the YES price is 90%+ — the real probability is often 95%+. " +
      "Conversely, 5¢ YES contracts are almost always overpriced relative to true base rates. " +
      "The bias is strongest in markets with low liquidity and high emotional salience.",
    sourceType: "external",
    sourceRef: "https://en.wikipedia.org/wiki/Favourite-longshot_bias",
    confidencePct: 70,
    tags: ["edge-finding", "bias", "favorite-longshot", "proven"],
  },
  {
    id: "pm:edge:correlated-markets",
    domain: "prediction-market",
    title: "Correlated markets often misprice conditional probabilities",
    content:
      "When two markets share a causal driver, their prices should be consistent — but often aren't. " +
      "Example: if 'Fed cuts rates in June' is at 40% and 'S&P above 5500 by July' is at 60%, " +
      "but a rate cut would almost certainly push S&P above 5500, one market is wrong. " +
      "Look for clusters of related markets and check if conditional probabilities are coherent. " +
      "Multi-market arbitrage requires identifying the shared driver and betting on the mispriced leg. " +
      "This edge is largest when markets resolve at different times — the near-dated resolution " +
      "gives information advantage for the later-dated position.",
    sourceType: "external",
    sourceRef:
      "https://medium.com/illumination/beyond-simple-arbitrage-4-polymarket-strategies-bots-actually-profit-from-in-2026-ddacc92c5b4f",
    confidencePct: 50,
    tags: ["edge-finding", "correlation", "arbitrage", "multi-market"],
  },
  {
    id: "pm:edge:news-velocity",
    domain: "prediction-market",
    title: "News-driven mispricing windows last 2-15 minutes on Polymarket",
    content:
      "When material news breaks, Polymarket prices lag real-world information by 2-15 minutes. " +
      "This window is shorter for high-liquidity political markets (< 5 min) and longer for " +
      "niche markets like crypto governance or international events (10-15 min). " +
      "The edge: monitor fast news sources (AP, Reuters terminals, Twitter/X breaking accounts) " +
      "and act before the CLOB order book updates. Size conservatively — the first mover " +
      "advantage is real but the window is narrow and you may be wrong about the news impact. " +
      "Automated news sentiment to market price comparison is the scalable version of this strategy.",
    sourceType: "external",
    sourceRef:
      "https://medium.com/@monolith.vc/5-ways-to-make-100k-on-polymarket-f6368eed98f5",
    confidencePct: 50,
    tags: ["edge-finding", "news", "speed", "timing"],
  },
  {
    id: "pm:edge:resolution-clarity",
    domain: "prediction-market",
    title: "Markets with ambiguous resolution criteria are systematically mispriced",
    content:
      "Polymarket pays on exact resolution criteria, not on what traders think the question means. " +
      "Ambiguous resolution rules create persistent mispricing because traders disagree on what " +
      "outcome will actually trigger payout. Edge: read the resolution source and criteria carefully. " +
      "When the resolution depends on a specific source (e.g., 'per BLS CPI report'), trade on " +
      "your understanding of that source's methodology, not on the colloquial meaning. " +
      "Markets about subjective outcomes ('will X be considered a success') are especially prone " +
      "to this — the resolution oracle's judgment may differ from public consensus.",
    sourceType: "external",
    sourceRef:
      "https://medium.com/thecapital/the-complete-polymarket-playbook-finding-real-edges-in-the-9b-prediction-market-revolution-a2c1d0a47d9d",
    confidencePct: 60,
    tags: ["edge-finding", "resolution", "criteria", "ambiguity"],
  },

  // ── Market Structure ───────────────────────────────────────────────────

  {
    id: "pm:structure:clob-mechanics",
    domain: "prediction-market",
    title: "Polymarket uses a hybrid CLOB model on Polygon with USDC settlement",
    content:
      "Polymarket's Central Limit Order Book (CLOB) operates via a custom exchange contract on Polygon. " +
      "All positions are denominated in USDC. Shares are binary CTF (Conditional Token Framework) " +
      "tokens — YES and NO shares for each market. A YES+NO pair always resolves to $1.00. " +
      "Trades settle on-chain but the order book is off-chain (operator-hosted matching engine). " +
      "Limit orders are free to place. Market orders pay taker fees. The Gamma API provides " +
      "real-time order book depth and trade history. Rate limits: ~15K requests per 10 seconds " +
      "combined across CLOB, Gamma, and Data APIs. Cloudflare queues excess requests rather than " +
      "returning 429s — your client will see increased latency, not errors.",
    sourceType: "external",
    sourceRef: "https://docs.polymarket.com",
    confidencePct: CONFIDENCE.VERIFIED,
    tags: ["market-structure", "clob", "polygon", "usdc", "api"],
  },
  {
    id: "pm:structure:liquidity-patterns",
    domain: "prediction-market",
    title: "Polymarket liquidity concentrates in political/macro markets; thin in niche",
    content:
      "As of 2026, Polymarket's total open interest exceeds $9B but is heavily concentrated: " +
      "US political markets (presidential, congressional) hold 40%+ of all liquidity. " +
      "Crypto governance, international politics, and entertainment markets often have < $50K " +
      "in total liquidity with spreads of 3-8%. These thin markets are where the largest " +
      "mispricings live, but they also have the highest execution risk — you move the price " +
      "against yourself when entering or exiting. Strategy: use limit orders in thin markets " +
      "(never market orders), scale position size to ~5% of market liquidity at most, " +
      "and factor in the cost of exit when calculating expected value.",
    sourceType: "external",
    sourceRef: "https://www.datawallet.com/crypto/top-polymarket-trading-strategies",
    confidencePct: 50,
    tags: ["market-structure", "liquidity", "spreads", "sizing"],
  },
  {
    id: "pm:structure:rewards-program",
    domain: "prediction-market",
    title: "Polymarket liquidity rewards program subsidizes limit order placement",
    content:
      "Polymarket runs a periodic rewards program that pays USDC to market makers who place " +
      "competitive limit orders. Rewards are proportional to: (1) time orders stay on the book, " +
      "(2) tightness of spread (closer to mid = more reward), (3) volume of the market. " +
      "This creates an edge for passive strategies: placing tight two-sided quotes " +
      "(both YES and NO limit orders near the mid) can be profitable even if the directional " +
      "view is neutral, purely from the rebate. Risk: adverse selection — informed traders hit " +
      "your limit orders right before a news event, leaving you on the wrong side. " +
      "Mitigate by pulling quotes ahead of known scheduled events (economic releases, elections).",
    sourceType: "external",
    sourceRef: "https://docs.polymarket.com",
    confidencePct: 50,
    tags: ["market-structure", "rewards", "market-making", "liquidity-provision"],
  },

  // ── Methodology ────────────────────────────────────────────────────────

  {
    id: "pm:method:base-rate-anchoring",
    domain: "prediction-market",
    title: "Base rate anchoring: always start from historical frequency, not narrative",
    content:
      "The single most important analytical discipline: before evaluating any market, " +
      "find the historical base rate for the event class. 'Will sitting president win re-election?' " +
      "has a base rate of ~67% since 1900. 'Will Fed cut rates this meeting?' depends on the " +
      "current cycle position but averages ~25% across all meetings. Adjust from the base rate " +
      "using specific evidence, not narrative or gut feeling. Most traders anchor on narrative " +
      "('this time is different') and systematically ignore base rates — this is why calibrated " +
      "analysts have edge. A market price that deviates >15% from the evidence-adjusted base rate " +
      "is a candidate for a position.",
    sourceType: "human",
    confidencePct: CONFIDENCE.VERIFIED,
    tags: ["methodology", "base-rate", "calibration", "analysis"],
  },
  {
    id: "pm:method:kelly-sizing",
    domain: "prediction-market",
    title: "Kelly criterion for prediction market position sizing",
    content:
      "Kelly formula: f* = (bp - q) / b, where b = net odds (payout/risk - 1), " +
      "p = estimated true probability, q = 1 - p. For a YES share at 60c where you estimate " +
      "true probability at 75%: b = 0.40/0.60 = 0.667, f* = (0.667 * 0.75 - 0.25) / 0.667 = 37.5% " +
      "of bankroll. In practice, use HALF-Kelly (f*/2 = ~19%) to account for estimation error. " +
      "Never exceed quarter-Kelly on a single market. Prediction market edges are real but small — " +
      "a 5% edge on a 60c contract means expected profit of ~3.3c/share before fees. " +
      "You need many uncorrelated positions to smooth variance. " +
      "If you cannot calculate Kelly for a position, you do not have a quantified edge — pass.",
    sourceType: "external",
    sourceRef: "https://en.wikipedia.org/wiki/Kelly_criterion",
    confidencePct: 70,
    tags: ["methodology", "sizing", "kelly", "risk-management"],
  },

  // ── Risk Management & Anti-Patterns ────────────────────────────────────

  {
    id: "pm:risk:fee-awareness",
    domain: "prediction-market",
    title: "Transaction fees and gas costs erode thin edges — calculate net EV",
    content:
      "Polymarket charges taker fees on market orders. Polygon gas costs are low (~$0.01) but " +
      "add up across many transactions. More important: the spread is the invisible fee. " +
      "If the bid/ask on a YES contract is 72c/74c and you think fair value is 75%, " +
      "your edge after crossing the spread is only 1c (75c - 74c), not 3c (75c - 72c). " +
      "This means: (1) always use limit orders when your thesis is not time-sensitive, " +
      "(2) never chase a 1-2% edge in thin markets where spread eats the profit, " +
      "(3) factor in total round-trip cost (entry spread + exit spread + fees + gas) " +
      "before sizing. A 5% gross edge that becomes 1% net is still a trade; " +
      "a 3% gross edge that becomes -1% net is a trap.",
    sourceType: "derived",
    confidencePct: 60,
    tags: ["risk-management", "fees", "spread", "execution-cost"],
  },
  {
    id: "pm:risk:anti-pattern-narrative-trading",
    domain: "prediction-market",
    title: "Anti-pattern: trading on narrative conviction without quantified edge",
    content:
      "The most common failure mode: 'I just KNOW this candidate will win' without a calibrated " +
      "probability estimate grounded in data. Narrative conviction feels like edge but is not. " +
      "Signs you are narrative trading: (1) you cannot state your probability estimate as a number, " +
      "(2) you have not checked the base rate, (3) your position size is based on conviction " +
      "not Kelly, (4) you are averaging down on a losing position because 'the market is wrong'. " +
      "The market IS wrong sometimes — but proving it requires evidence, not feeling. " +
      "Rule: if you cannot write a one-paragraph thesis with a numeric probability, a base rate " +
      "anchor, and specific evidence for your update, you do not have a trade.",
    sourceType: "human",
    confidencePct: CONFIDENCE.VERIFIED,
    tags: ["anti-pattern", "narrative", "discipline", "risk-management"],
  },
  {
    id: "pm:risk:anti-pattern-illiquid-size",
    domain: "prediction-market",
    title: "Anti-pattern: oversizing in illiquid markets with no exit",
    content:
      "A 20% edge means nothing if you cannot exit the position at a reasonable price. " +
      "In markets with < $25K total liquidity, even a $1K position represents 4%+ of the book. " +
      "Entering is easy (you cross the ask); exiting is hard (your sell order IS the bid). " +
      "Worst case: the market moves against you, liquidity vanishes, and you hold to resolution " +
      "whether you want to or not. Rule: max position should be 5% of 24h volume or 2% of total OI, " +
      "whichever is smaller. If you cannot exit gracefully, size as if you are holding to resolution.",
    sourceType: "derived",
    confidencePct: 60,
    tags: ["anti-pattern", "liquidity", "sizing", "exit-risk"],
  },

  // ── Data Sources ───────────────────────────────────────────────────────

  {
    id: "pm:data:hf-datasets",
    domain: "prediction-market",
    title: "Polymarket on-chain data is available as HuggingFace datasets — do not scrape",
    content:
      "Three pre-built datasets for quantitative analysis: " +
      "SII-WANGZJ/Polymarket_data (1.1B records, 107GB, full on-chain history), " +
      "CK0607/polymarket_10000 (10K market summaries), " +
      "AiYa1729/polymarket-transactions (transaction-level). " +
      "For market snapshots and order book data, use the Gamma API (REST) and CLOB API (WebSocket). " +
      "For historical resolution data, use the Goldsky subgraph (warproxxx/poly_data on GitHub). " +
      "Do NOT scrape the Polymarket frontend — it is a React SPA and the data is all available " +
      "through APIs and pre-built datasets at higher quality.",
    sourceType: "external",
    sourceRef: "https://huggingface.co/datasets/SII-WANGZJ/Polymarket_data",
    confidencePct: CONFIDENCE.VERIFIED,
    tags: ["data", "huggingface", "datasets", "api", "quantitative"],
  },
];
