---
id: research-poly-strategy-knowledge-ingestion-mcp
type: research
title: "Knowledge Chunk: MCP Stack for Per-Node Strategy Knowledge Graphs (Polymarket)"
status: active
trust: draft
summary: "Survey of free/OSS MCP servers for scraping + knowledge-graph construction, applied to the poly node use case of building a Polymarket-strategy expertise KB. Recommends Firecrawl + Apify Reddit → Graphiti (FalkorDB) as the minimum-viable stack. KnowledgeCapability port is already shipped — the gap is ingestion."
read_when: Choosing an ingestion MCP stack for a node's domain expertise KB, evaluating Graphiti vs Mem0 vs mcp-memory, or wiring external scrapers into the KnowledgeCapability port.
owner: derekg1729
created: 2026-04-15
verified: 2026-04-15
tags:
  [
    knowledge-chunk,
    mcp,
    knowledge-graph,
    polymarket,
    poly-node,
    graphiti,
    firecrawl,
    ingestion,
    scraping,
  ]
---

# MCP Stack for Per-Node Strategy Knowledge Graphs — Polymarket

> source: agent research session 2026-04-15 | confidence: medium-high | freshness: re-check quarterly; MCP ecosystem moving fast

## Question

What is the best **free / OSS MCP stack today** for scraping public web content and organizing it into a knowledge graph that a domain-specific node agent (poly, resy, …) can query for expertise? Concrete driver: stand up a poly-brain knowledge surface covering Polymarket trading strategies, postmortems, and edge-finding heuristics — and have a pattern that repeats for every future niche node.

## Context

The poly node ships today as a LangGraph ReAct agent with two tools: `MARKET_LIST_NAME` (Polymarket + Kalshi) and `WEB_SEARCH_NAME`. It is live but read-only to current market data — it has no durable expertise memory and no way to ingest outside knowledge.

The relevant infrastructure is **already built**:

- `KnowledgeCapability` port — `packages/ai-tools/src/capabilities/knowledge.ts:69` — defines `search() / list() / get() / write()` with confidence tiers (DRAFT 30%, VERIFIED 80%, HARDENED 95%).
- Core tools `core__knowledge_search / read / write` — wired into poly's tool-bindings at `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts:112-120`.
- `DoltgresKnowledgeStoreAdapter` — `packages/knowledge-store/src/adapters/doltgres/` — versioned writes (auto `dolt_commit`), keyword search over domain/title/content.
- MCP client plumbing — `McpConnectionCache` + `ErrorDetectingMcpToolSource` in `nodes/node-template/app/src/bootstrap/graph-executor.factory.ts`; `MCP_SERVERS` env parsed by `parseMcpConfigFromEnv()`.

So the store, the capability, the tools, and the MCP client are all in place. What is missing is the **ingestion pipeline**: a way to pull strategy content from the open web and land it in the knowledge store as structured entries. That is the narrow scope of this doc. Broader retrieval/indexing design lives in `docs/research/ai-knowledge-storage-indexing-retrieval.md`.

## Findings

### Scraping MCPs

| MCP                            | What it does                                                           | Free tier              | Strengths                                                                                                     | Weaknesses                                    |
| ------------------------------ | ---------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Firecrawl MCP**              | URL → clean markdown/JSON; crawl, extract, sessions, login persistence | Generous free tier     | Best-in-class markdown for RAG; persistent sessions; `firecrawl_interact` for click/fill; actively maintained | Hosted free-tier capped; self-host is heavier |
| **Playwright MCP** (Microsoft) | Real browser via accessibility tree                                    | 100% free, self-hosted | JS-heavy sites, login flows, no rate limits                                                                   | You operate the browser fleet; more glue      |
| **Jina Reader**                | Prepend `r.jina.ai/` → markdown                                        | Free, rate-limited     | Zero infra, trivial                                                                                           | No login, no JS, no crawl                     |
| **Apify MCP**                  | 1500+ pre-built "Actors" incl. Reddit / Twitter / Medium scrapers      | $5/mo credits          | Battle-tested niche scrapers, handles anti-bot                                                                | Credits burn; realistic cost ~$39+/mo         |
| **Exa MCP**                    | Semantic web search (not scrape)                                       | 1k req/mo free         | Finds _relevant_ pages by meaning                                                                             | Search-only                                   |
| **Tavily MCP**                 | Search + multi-step research mode                                      | Per-credit             | Built-in research planning                                                                                    | Per-call cost stacks                          |
| **Bright Data MCP**            | Web Unlocker for hard targets                                          | Paid                   | CAPTCHAs, anti-fingerprinting                                                                                 | Expensive; overkill                           |
| **ScrapeGraph**                | LLM-driven natural-language schema scraping                            | Apache 2.0             | Schema-as-prompt is elegant                                                                                   | MCP wrapper immature                          |

Community consensus: **Firecrawl + Playwright** are the two-horse race. **Jina** is the text-only backup. **Apify** wins when you need pre-built scrapers (Reddit, Twitter, Medium) and don't want to write them yourself.

### Knowledge-Graph MCPs

| MCP                                          | Storage model                                    | Ingestion                                                             | Query                                   | License                                                              |
| -------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| **Graphiti MCP** (Zep)                       | Temporal KG on Neo4j / FalkorDB / Kuzu / Neptune | LLM extracts entities+edges, invalidates contradictions incrementally | Hybrid: vector + BM25 + graph traversal | Apache 2.0                                                           |
| **`mcp-server-memory`** (Anthropic official) | Entity/relation graph in JSON file               | Manual `create_entities / create_relations`                           | `search_nodes`, `read_graph`            | MIT                                                                  |
| **Neo4j MCP** (official)                     | Pure Neo4j                                       | You write Cypher                                                      | Cypher queries, schema introspection    | Apache 2.0                                                           |
| **mcp-qdrant-memory** (delorenj)             | KG + Qdrant vectors hybrid                       | OpenAI embeddings + entity CRUD                                       | Semantic search over entities/relations | MIT                                                                  |
| **Official Qdrant MCP**                      | Pure vector store shaped as memory               | Embed + store                                                         | Semantic similarity                     | Apache 2.0                                                           |
| **Mem0**                                     | Vector + optional graph                          | Auto memory extraction                                                | Memory recall API                       | Apache 2.0 — **graph layer is Pro-only ($249/mo)**, don't get burned |

**LongMemEval benchmark** (independent, GPT-4o): Zep/Graphiti **63.8 %** vs Mem0 **49.0 %** on retrieval quality. Graphiti is meaningfully ahead — and it's the only option with **temporal awareness**, which matters for strategies that evolve and postmortems that contradict earlier writeups.

### Battle-tested combos

- **Firecrawl → Graphiti → Neo4j/FalkorDB** — the modern "agentic RAG" pattern cited by both Firecrawl and Zep docs. Reference repo: `Alejandro-Candela/agentic-rag-knowledge-graph`. **Most proven.**
- **Apify (Reddit / Medium actors) → Graphiti** — theoretically clean, less documented; Apify gives you scrapers Firecrawl does not pre-bundle.
- **Playwright MCP → mcp-qdrant-memory** — fully self-hosted, zero recurring cost, but you build the glue.
- **Jina Reader → mcp-server-memory** — MVP/toy tier; not appropriate for a trading agent.

### Polymarket-specific reality check

- **Market data: easy.** CLOB / Gamma / Data APIs are documented; ~15 k req / 10 s combined cap; Cloudflare queues rather than 429s. Goldsky subgraph mirror exists.
- **Pre-built datasets on Hugging Face** for on-chain history: `SII-WANGZJ/Polymarket_data` (1.1 B records, 107 GB), `CK0607/polymarket_10000`, `AiYa1729/polymarket-transactions`. **For raw market data, don't scrape — download.**
- **Strategy _content_ is scattered.** No central forum. Lives on Medium (`monolith.vc`, `JIN/The Capital`, `dexoryn`), Reddit `r/polymarket` (~50 k members), `laikalabs.ai`, `datawallet.com`, `cryptonews.com`. Most blogs are scrape-friendly (no hard JS). Reddit needs Apify's Reddit Actor or PRAW.
- **No curated "Polymarket strategy" dataset exists.** You are building it.

## Recommendation

**Minimum-viable stack (ships this week, effectively free):**

- **Scrape:** Firecrawl MCP free tier for blogs/Medium + Apify Reddit Actor ($5/mo credits) for `r/polymarket`.
- **Graph:** Graphiti MCP + **FalkorDB** (lighter than Neo4j, single Docker container, Graphiti default backend).
- **Glue:** Nightly job inside `nodes/poly/` that walks a curated URL seed list through Firecrawl and feeds pages into Graphiti `add_episode`. Persist Graphiti episode IDs as `KnowledgeEntry` rows in Doltgres so the existing `core__knowledge_search` tool continues to be the agent's entry point.
- **Bonus:** Pull the Hugging Face on-chain datasets into Postgres separately — that's quantitative features, not qualitative KB, and shouldn't fight the strategy graph for schema space.

**Top 0.1 % (when cost/effort are no object):**

- **Scrape:** Firecrawl Pro (deep crawl + Agent endpoint) + Bright Data MCP (anti-bot fallback) + Exa MCP (semantic source discovery).
- **Graph:** Graphiti on managed Neo4j Aura, plus Postgres + pgvector alongside for full-text prose retrieval — the agentic-RAG reference pattern end-state.
- **Memory ops:** Zep Cloud on top of Graphiti for managed temporal queries + governance.
- **Per-node isolation:** One Graphiti namespace per node (`poly`, `resy`) so KBs don't cross-contaminate — fits the sovereign `nodes/{node}/` model.

**Hype to discount:**

- **Mem0 "graph mode"** — Pro-only at $249/mo despite the Apache license framing.
- **ScrapeGraph** — elegant idea, MCP wrapper not yet mature.
- **Tavily research mode** — useful, but per-call cost stacks fast.

## Open questions

- Does Graphiti's `add_episode` ingestion compose cleanly with the existing `KnowledgeCapability.write()` tier/confidence model, or do we need a second write path that bypasses Doltgres versioning?
- Can we store Graphiti graph state _inside_ Doltgres (as JSON / edge rows) to keep one source of truth and preserve the `dolt_commit` audit trail, or does Graphiti's ingestion assume native Neo4j/FalkorDB?
- What is the right **per-niche isolation boundary**? One graph per node with a shared ontology, or fully independent graphs? The node-sovereignty model pushes toward full isolation; retrieval quality across nodes pushes toward shared entities with node-scoped edges.
- Reddit API ToS posture in 2026 — is the Apify Reddit Actor durable or do we need a self-hosted PRAW adapter?
- Has FalkorDB closed the query-performance gap on Neo4j for Graphiti workloads? Last public benchmarks predate 2026.

## Proposed Layout

This is directional, not binding — intended to feed `/triage` and `/task` downstream.

### Project

`proj.poly-knowledge-graph` — _Poly Node Strategy Knowledge Graph_

- **Goal:** poly-brain can answer "what's the edge on markets matching criteria X" with cited expertise pulled from the open web, not just live order-book data.
- **Phases:**
  1. **Ingestion MVP** — Firecrawl MCP + curated seed list + manual → `KnowledgeCapability.write()`. No graph yet.
  2. **Graph layer** — Graphiti MCP + FalkorDB behind an adapter. Knowledge entries reference graph episodes by ID.
  3. **Niche scalers** — Reddit (Apify) + nightly refresh cron + source trust tiers.
  4. **Queryable from poly-brain** — hybrid retrieval: `core__knowledge_search` (Doltgres) + a new `core__graph_query` tool (Graphiti).

### Specs

- **New:** `docs/spec/knowledge-graph-ingestion.md` — defines the port between the existing `KnowledgeCapability` and a pluggable `KnowledgeGraphPort` (Graphiti adapter as first concrete), the episode → entry mapping, and the niche-isolation rule.
- **Update:** `ai-knowledge-storage-indexing-retrieval.md` research doc — cross-reference this doc; note that graph layer is now designed, not hypothetical.
- **Update:** `nodes/poly/AGENTS.md` — document the curated seed-list convention and the ingestion job location.

### Tasks (PR-sized, rough sequence)

1. `task.*` **Wire Firecrawl MCP into poly node** — add to `MCP_SERVERS` config, verify `core__knowledge_search` / `core__knowledge_write` are already callable by poly-brain, smoke test one blog → entry round-trip.
2. `task.*` **Curated Polymarket strategy seed list** — check in `nodes/poly/.cogni/knowledge-seeds.yaml` with ~20 vetted URLs (Medium strategy posts, `r/polymarket` FAQs, `datawallet.com` writeups). Include trust tier per source.
3. `task.*` **Nightly ingestion cron** — scheduler-worker job that walks seed list → Firecrawl → `KnowledgeCapability.write()` with DRAFT trust. Idempotent on URL + content hash.
4. `spike.*` **Graphiti adapter design** — evaluate whether Graphiti episodes can be shimmed behind `KnowledgeCapability` or need a sibling `KnowledgeGraphPort`. Decide FalkorDB vs Neo4j for the first cut. Output: design doc + rejected alternatives.
5. `task.*` **Apify Reddit ingestion** — add `r/polymarket` scraper as a second ingestion source; respect trust tiers (Reddit = DRAFT, curated blogs = VERIFIED).
6. `task.*` **`core__graph_query` tool for poly-brain** — read-path hybrid: Graphiti graph traversal alongside Doltgres keyword search. Wire into `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts`.
7. `task.*` **Per-node namespace isolation** — enforce that `poly` ingestions never write into `resy`'s graph and vice versa. Hard boundary in the adapter.

### Explicitly out of scope here

- Retrieval ranking / re-ranking (lives in `ai-knowledge-storage-indexing-retrieval.md`).
- On-chain Polymarket quantitative data pipeline (separate project; use the HF datasets).
- User-facing strategy recommendations UI (comes after the agent can actually query).
