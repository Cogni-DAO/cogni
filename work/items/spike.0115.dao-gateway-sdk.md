---
id: spike.0115
type: spike
title: Research DAO Gateway SDK — simplest path for AI projects to become DAOs
status: done
priority: 1
estimate: 2
summary: Research how CogniDAO could become a minimal passthrough layer (SDK/gateway) that lets any AI project add DAO governance + crypto billing via a .cogni/repo-spec config file.
outcome: Research doc with option analysis (gateway vs SDK vs x402), phased recommendation, and proposed project/task layout.
spec_refs:
assignees: derekg1729
credit: SnappedAI (Kai) / Connor (moonbags) — MDI partnership proposal (story.0118) motivated this spike
project:
branch:
pr:
reviewer:
created: 2026-02-26
updated: 2026-02-26
labels: [dao, sdk, billing, product]
external_refs:
  - docs/research/dao-gateway-sdk.md
  - story.0118 (MDI partnership — motivated this research)
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Spike: DAO Gateway SDK Research

## Question

What is the simplest + cleanest way CogniDAO could empower AI projects to become DAOs? Could we be a passthrough layer — an SDK or gateway — where a project adds a `.cogni/repo-spec` and routes AI calls through our interface to get crypto payments and DAO funding?

## Findings

## Validation

- [x] Research doc written: `docs/research/dao-gateway-sdk.md`
- [x] Follow-up story created: `story.0116`

## Findings

See [research doc](../../docs/research/dao-gateway-sdk.md) for full analysis.

### TL;DR

**Recommended: Config-File Gateway (3 phases)**

1. **Phase 1** — Multi-tenant the existing LiteLLM + billing stack as an OpenAI-compatible gateway. Projects add `.cogni/repo-spec.yaml`, get an API key, swap their base URL. ~2 weeks.
2. **Phase 2** — Add x402 protocol for per-request crypto payments (agent-to-agent commerce). ~1 week.
3. **Phase 3** — Extract SDK packages (`@cogni/billing-core`, `@cogni/gateway-middleware`) for self-hosted mode. ~4-6 weeks.

### Key findings

- **x402 (Coinbase)** is the closest to "1 line of code, get crypto payments" — Express middleware, open standard, Stripe has adopted it
- **Nevermined** is the AI-native billing platform (A2A + MCP integration)
- **Snapshot** is the simplest governance (JSON config, gasless, free) — good "lite" tier
- **Our existing stack** already does 90% of what's needed — it just needs multi-tenanting
