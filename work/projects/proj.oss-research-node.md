---
id: proj.oss-research-node
type: project
primary_charter:
title: "OSS Research AI Node — First Cogni Niche Specialization"
state: Active
priority: 1
estimate: 5
summary: Build a specialized Cogni service that continuously researches open-source technologies, maintains an organized knowledge base (with license awareness), serves recommendations via x402 AI endpoint and human chat UI, and (vNext) scans codebases for OSS swap opportunities.
outcome: A deployable service within this repo that earns revenue by answering "I'm trying to do X — what OSS should I use?" via x402 micropayment endpoint and human chat UI, backed by a continuously-updated knowledge base of OSS projects, licenses, and recommendations.
assignees: derekg1729
created: 2026-03-05
updated: 2026-03-05
labels: [niche-node, oss, ai, x402, content]
---

# OSS Research AI Node — First Cogni Niche Specialization

> Story: `story.0136` | Spike: `spike.0137`

## Goal

Build the first Cogni niche specialization: an AI service that becomes the authority on open-source software — what exists, what license it uses, when to pick it, and how to integrate it. This starts as a new service within the node-template monorepo (`services/oss-advisor/`), following established service architecture patterns. It earns revenue through x402 micropayments for AI-powered OSS recommendations. The knowledge base is continuously updated by an autonomous research agent, and findings are published as blog content for organic discovery.

**Relationship to Node vs Operator architecture:** This is a Node-owned service, not Operator infrastructure. It follows the same sovereignty invariants as any Node service (wallet custody, data sovereignty, deploy independence, fork freedom). A future fork could spin this into a standalone Node — but P0 ships it as a service within the existing Node.

**Relationship to existing projects:**

- **proj.x402-e2e-migration** — provides the x402 inbound payment middleware this service will use
- **proj.agentic-interop** — provides MCP/A2A discovery so other agents can find this service
- **proj.graph-execution** — provides the LangGraph execution patterns this service's AI pipelines use
- **proj.maximize-oss-tools** — different concern: that project adopts OSS for our own infra; this project _sells_ OSS knowledge to others

## Roadmap

### Crawl (P0) — Knowledge Base + Research Agent MVP

**Goal:** A working research agent that discovers, evaluates, and catalogs OSS projects into a structured knowledge base. Queryable via internal API. No payment gate yet.

| Deliverable                                                                                   | Status      | Est | Work Item  |
| --------------------------------------------------------------------------------------------- | ----------- | --- | ---------- |
| Research spike: x402 protocol, OSS data sources, knowledge base schema, node specialization   | Not Started | 3   | spike.0137 |
| Service scaffold: `services/oss-advisor/` with health endpoints, config, Dockerfile           | Not Started | 2   | —          |
| Knowledge base schema: projects, licenses, categories, alternatives, maturity signals         | Not Started | 2   | —          |
| OSS data ingestion: GitHub API adapter (repos, licenses, stars, contributors, last commit)    | Not Started | 2   | —          |
| License classification: SPDX identifier extraction, copyleft/permissive/weak-copyleft tagging | Not Started | 1   | —          |
| Research agent graph: LangGraph pipeline that discovers → evaluates → catalogs OSS projects   | Not Started | 3   | —          |
| Internal query API: "I need X" → ranked recommendations with license info and tradeoffs       | Not Started | 2   | —          |
| Taxonomy seed: initial categories (web framework, database, auth, queue, observability, etc.) | Not Started | 1   | —          |
| Eval harness: recommendation quality evaluation (precision, license accuracy, relevance)      | Not Started | 2   | —          |

### Walk (P1) — x402 Endpoint + Human UI + Content Pipeline

**Goal:** Paying customers. x402 endpoint for agent-to-agent queries, human chat UI, and automated blog content for organic discovery.

| Deliverable                                                                                  | Status      | Est | Work Item            |
| -------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| x402 inbound middleware on advisor endpoint (depends on `proj.x402-e2e-migration` P0)        | Not Started | 2   | (create at P1 start) |
| Agent discovery: `.well-known/agent.json` card advertising OSS advisor capability            | Not Started | 1   | (create at P1 start) |
| MCP tool: expose `oss-recommend` tool via MCP server (depends on `proj.agentic-interop` P0)  | Not Started | 1   | (create at P1 start) |
| Human chat UI: conversational interface for OSS questions                                    | Not Started | 3   | (create at P1 start) |
| Searchable browse UI: filter by category, license type, use case, maturity                   | Not Started | 2   | (create at P1 start) |
| Content generation agent: LangGraph pipeline that produces blog posts from research findings | Not Started | 2   | (create at P1 start) |
| Blog publishing: static site generation from generated content (markdown → deployed site)    | Not Started | 2   | (create at P1 start) |
| Additional data sources: Libraries.io, OpenSSF Scorecard, npm/PyPI download stats            | Not Started | 2   | (create at P1 start) |
| License compatibility engine: "can I use GPL lib in my MIT project?" analysis                | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Codebase Scanner + Standalone Node

**Goal:** Premium tier: connect to a codebase, scan for OSS swap opportunities, and implement the swaps. Optionally spin off as standalone Node.

| Deliverable                                                                                       | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Codebase scanner: analyze dependency files (package.json, requirements.txt, go.mod, etc.)         | Not Started | 3   | (create at P2 start) |
| Swap recommendation engine: identify proprietary/suboptimal deps with OSS alternatives            | Not Started | 2   | (create at P2 start) |
| License compatibility audit: flag license conflicts in existing dependency trees                  | Not Started | 2   | (create at P2 start) |
| Agent-assisted migration: generate PRs that swap dependencies (with human approval gate)          | Not Started | 3   | (create at P2 start) |
| Standalone Node extraction: fork into independent repo with own DAO + deployment                  | Not Started | 3   | (create at P2 start) |
| Continuous refresh pipeline: scheduled re-evaluation of cataloged projects for staleness/archival | Not Started | 2   | (create at P2 start) |

## Constraints

- Service lives in `services/oss-advisor/` — follows all service architecture invariants (isolation, health endpoints, own config, standalone build)
- Service cannot import `src/` — only `packages/` and own code (enforced by dependency-cruiser)
- Knowledge base uses the Node's existing Postgres (new tables, same DB) — no separate database in P0
- Research agent must ground all recommendations in verifiable data (GitHub API, SPDX) — no hallucinated project names or license types
- x402 integration reuses `proj.x402-e2e-migration` middleware — no custom payment implementation
- Blog content must be factually accurate and cite sources — no AI-generated misinformation
- License classification uses SPDX identifiers as canonical source of truth
- P0 ships without payment gate — proving the knowledge base and recommendation quality comes first
- No premature Node extraction — standalone fork happens at P2+ only after revenue is proven

## Dependencies

- [ ] `proj.x402-e2e-migration` P0 — x402 inbound middleware (needed for P1)
- [ ] `proj.agentic-interop` P0 — MCP server for tool exposure (needed for P1)
- [ ] `proj.graph-execution` — LangGraph execution patterns (needed for P0 research agent)
- [ ] `proj.cicd-services-gitops` — service CI/CD wiring (needed for deployment)
- [ ] GitHub API access — rate limits may require authenticated token (5000 req/hr)
- [ ] `spike.0137` completion — research findings inform detailed P0 task breakdown

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Why a service, not a standalone Node fork?

The user's instinct ("very likely we should spawn this as a new independent service, starting within this repo for now") aligns with the established monorepo-first pattern. Benefits:

1. **Reuse existing infra** — Postgres, Docker Compose, CI/CD, health probes, observability
2. **Share packages** — `@cogni/ai-core`, `@cogni/langgraph-graphs`, `@cogni/db-schema`
3. **Avoid premature extraction** — same guardrail as Operator extraction: prove value first, extract later
4. **Service scaffold exists** — `services/scheduler-worker/` is the template; copy the pattern

The P2 extraction path is clear: when the OSS advisor has paying customers, fork the repo, strip non-advisor code, set up independent DAO + deployment.

### Knowledge base architecture (to be confirmed by spike.0137)

Options under consideration:

1. **Relational (Postgres)** — familiar, joins for taxonomy, works with existing stack. License/category as normalized tables.
2. **Hybrid: Postgres + pgvector** — relational for structured data, vector embeddings for "I'm trying to do X" semantic search.
3. **Graph DB (Neo4j)** — natural for "alternative to" and "works with" relationships. Adds operational complexity.

Leaning toward option 2 (Postgres + pgvector) — minimal new infra, good semantic search for the recommendation use case. Spike will confirm.

### Research agent design (to be confirmed by spike.0137)

The research agent is a LangGraph graph with three phases:

1. **Discover** — GitHub trending, topic search, "awesome-list" crawling, Libraries.io new releases
2. **Evaluate** — stars, commit frequency, contributor count, funding (GitHub Sponsors/OpenCollective), CVE history, SPDX license extraction
3. **Catalog** — write structured record to knowledge base, tag with taxonomy, link alternatives

Refresh cadence: weekly full scan of top categories, daily for trending/new releases, event-driven for specific queries that reveal gaps.

### x402 pricing model

Per-query pricing via x402 `upto` scheme:

- Simple recommendation query: ~$0.01-0.05 USDC
- Detailed comparison (multiple alternatives, license analysis): ~$0.05-0.25 USDC
- Codebase scan (P2): ~$1-5 USDC depending on repo size

Exact pricing TBD after cost modeling (LLM inference cost per query via LiteLLM).

### Content pipeline design

Research findings → content generation agent → markdown → static site (likely Astro or Next.js static export). SEO targets: "best open source [category] 2026", "[tool A] vs [tool B]", "MIT vs Apache-2.0 license comparison". Published on Node's domain. Revenue model: content drives organic traffic → users try chat UI → some become x402 API customers.
