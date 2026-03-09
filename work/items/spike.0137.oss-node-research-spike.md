---
id: spike.0137
type: spike
title: "OSS Research AI Node — Research Spike"
status: needs_research
priority: 1
rank: 99
estimate: 3
summary: Research spike for story.0136 — investigate x402 protocol, OSS data sources, knowledge base design, and node specialization patterns to inform the project roadmap.
outcome: Written research findings with clear recommendations on technology choices, data sources, and architecture — sufficient to create a project roadmap with crawl/walk/run phases.
spec_refs:
assignees: derekg1729
credit:
project: proj.oss-research-node
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-05
updated: 2026-03-06
labels: [niche-node, oss, ai, x402, research]
external_refs:
---

# OSS Research AI Node — Research Spike

Parent story: `story.0136`

## Requirements

Answer the following research questions with enough depth to create a project roadmap:

### 1. x402 Protocol & Agent-to-Agent Payments

- What is the current state of the x402 protocol? Is there a stable spec?
- How does an AI agent discover and pay for another agent's API endpoint via x402?
- What crypto rails does x402 use? Is it compatible with our Base/Aragon DAO setup?
- What are the alternatives (Lightning Network, Stripe Connect, custom)?
- Recommendation: which payment protocol for the OSS advisor endpoint?

### 2. OSS Data Sources & Research Pipeline

- What APIs/datasets exist for discovering OSS projects? (GitHub API, Libraries.io, OpenSSF Scorecard, SPDX, etc.)
- How do we evaluate project health/maturity programmatically? (stars, commits, contributors, funding, CVE history)
- How do we reliably extract and classify license types? (SPDX identifiers, license detection tools)
- What is the refresh cadence needed? (daily? weekly? event-driven?)
- Rate limits and cost implications of each data source

### 3. Knowledge Base Architecture

- Schema design: relational DB vs graph DB vs vector store vs hybrid?
- How to model: projects, licenses, categories, use-case mappings, alternatives?
- How to keep the knowledge base current (incremental updates vs full rebuilds)?
- How to handle conflicting or ambiguous license information?

### 4. AI Pipeline Design

- Which LangGraph patterns for: continuous research agent, recommendation agent, content generation agent?
- How to evaluate recommendation quality? (evals framework)
- How to avoid hallucinated project names or wrong license info? (grounding, retrieval)
- Token cost modeling for continuous research vs on-demand queries

### 5. Node Specialization Pattern

- What changes are needed to fork node-template into a domain-specialized Node?
- What stays generic (DAO, auth, billing, deploy) vs what gets specialized (graphs, UI, API)?
- How does this inform a repeatable "niche node" pattern for future specializations?

### 6. Content & Blog Pipeline

- Static site generation vs dynamic CMS vs markdown-in-repo?
- SEO strategy for OSS comparison content
- How to automate from research findings → published blog post?

## Allowed Changes

- `work/items/` — this spike and any sub-items
- `docs/` — research findings document (if warranted)
- `work/projects/` — project file creation after research concludes

## Plan

- [ ] Research x402 protocol: read spec, identify maturity, assess compatibility
- [ ] Survey OSS data sources: GitHub API, Libraries.io, OpenSSF, SPDX
- [ ] Evaluate knowledge base architecture options
- [ ] Draft AI pipeline design using LangGraph patterns from this repo
- [ ] Assess node specialization mechanics (what to fork, what to extend)
- [ ] Research content pipeline options
- [ ] Write findings document with recommendations
- [ ] Create project roadmap (`/project`)

## Validation

- Research findings document exists with clear recommendations per question area
- Each recommendation includes: option considered, pros/cons, and chosen approach with rationale
- Project roadmap created with crawl/walk/run phases informed by findings

## Review Checklist

- [ ] **Work Item:** `spike.0137` linked in PR body
- [ ] **Spec:** all invariants of linked specs (here, or project) are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Parent: `story.0136`

## Attribution

-
