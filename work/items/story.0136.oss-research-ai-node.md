---
id: story.0136
type: story
title: "OSS Research AI Node — First Cogni Niche Specialization"
status: done
priority: 1
rank: 99
estimate: 5
summary: First Cogni niche node specialization — an AI agent that continuously researches, organizes, and serves expert knowledge about open-source technologies, their licenses, and when/how to use them.
outcome: A specialized Cogni Node that serves as an OSS knowledge authority via x402 AI endpoint, human chat UI, and (vNext) codebase scanning for OSS swap recommendations.
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
labels: [niche-node, oss, ai, x402, content]
external_refs:
---

# OSS Research AI Node — First Cogni Niche Specialization

## Original Idea (verbatim)

> first Cogni niche node specialization to spinoff: professional AI mastering Open Source, and empowering AI agents to consult with our pro, to build what it needs using the right OSS for the job (and being aware of the license type).
>
> Research our node vs operator and roadmap.
>
> It's time to start our first niche. An AI node who's only job is to research and amass an organized knowledge hub of open source tecnologies and how/when to use them. Constantly researching, organizing, and posting blogs (customer awareness).
>
> Then, as the service:
>
> - x402 AI endpoint. Agent finds us and asks: I'm trying to do X, what should I do?
> - a human UI: chat page. And searchable lists of
> - vNext: connect our agent to your codebase, and: scan for OSS swappable tools. Let us implement the swaps
>
> Capture this exact input in the story. Then, research, design, and create a /project for this. How do we start?

## Context

This is the **first niche specialization** of the Cogni Node template. Rather than a general-purpose DAO, this Node focuses on a single domain: becoming the authoritative AI expert on open-source software — what exists, which license it uses, when to pick it, and how to integrate it.

### Relationship to Node vs Operator Architecture

- This is a **Node** (sovereign DAO+app), not an Operator service. It uses the node-template as its foundation.
- It has its own DAO, wallet, and deployment — fully sovereign per the [Node vs Operator Contract](../../docs/spec/node-operator-contract.md).
- Revenue comes from x402 micropayments for API consultations and (later) premium codebase scanning.
- The Operator may eventually list this Node in a registry, but the Node operates independently.

### Relationship to Roadmap

- Requires **Phase 0** (Node Formation) to be functional — the OSS Node needs its own DAO.
- Requires **Phase 1** (LangGraph + Evals) for the AI research and chat capabilities.
- Does NOT require Operator services (Phase 2-6) — this Node is self-contained.

## Requirements

### Knowledge Hub (Continuous Research)

- An AI agent that continuously discovers, evaluates, and catalogs open-source projects
- Structured knowledge base covering: project name, description, category, license type (MIT, Apache-2.0, GPL, etc.), use cases, alternatives, maturity signals (stars, last commit, funding)
- License-aware recommendations — the agent must understand license compatibility implications (e.g., GPL copyleft vs MIT permissive)
- Organized taxonomy: by domain (web framework, database, auth, etc.), by license, by maturity

### Content / Customer Awareness

- Automated blog post generation from research findings (e.g., "Top 5 OSS Auth Libraries in 2026", "MIT vs Apache-2.0: When It Matters")
- SEO-optimized content that drives organic discovery
- Published on the Node's own site

### Service Layer — x402 AI Endpoint

- An AI-powered API endpoint that other agents can call via x402 micropayment protocol
- Input: "I'm trying to do X" (natural language problem description)
- Output: Recommended OSS tools, license info, integration guidance, alternatives with tradeoffs
- Discovery: endpoint should be findable by other AI agents (standard API discovery patterns)

### Service Layer — Human UI

- Chat interface: humans can ask OSS questions conversationally
- Searchable lists: browse the knowledge base by category, license, use case
- Curated recommendations with comparison views

### vNext — Codebase Scanner

- Connect the agent to a user's codebase
- Scan for proprietary or suboptimal dependencies that have OSS alternatives
- Recommend swaps with license compatibility analysis
- Offer to implement the swaps (agent-assisted migration)

## Allowed Changes

- New Node instance (fork of node-template) with OSS-domain specialization
- New LangGraph graphs for research, recommendation, and content generation
- New database schemas for the knowledge base
- New API routes for x402 endpoint and chat UI
- New UI pages for chat and browse experiences
- Work items, projects, and specs in this repo to plan the effort

## Plan

- [ ] Research spike: x402 protocol, OSS data sources, knowledge graph design
- [ ] Design the knowledge base schema and taxonomy
- [ ] Design the AI research pipeline (what to crawl, how to evaluate, how to organize)
- [ ] Design the x402 endpoint contract
- [ ] Create project roadmap with crawl/walk/run phases
- [ ] Fork node-template and begin specialization

## Validation

- Story captured with full original input and enough context for triage
- Spike created for open research questions
- Project roadmap exists with phased delivery plan

## Review Checklist

- [ ] **Work Item:** `story.0136` linked in PR body
- [ ] **Spec:** all invariants of linked specs (here, or project) are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Spike: `spike.0137`

## Attribution

-
