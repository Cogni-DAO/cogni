---
id: spike.0158
type: spike
title: "Broadcasting Platform Integration — Research Spike"
status: done
priority: 1
rank: 10
estimate: 2
summary: Research API-first integration paths for multi-platform social media broadcasting with AI-generated content and human-in-the-loop approval via Temporal workflows.
outcome: Written research findings with platform-by-platform API analysis, OSS tool comparison, Temporal HITL workflow design, and a prioritized integration roadmap — sufficient to create a project roadmap with crawl/walk/run phases.
spec_refs:
assignees:
  - derekg1729
credit:
project: proj.broadcasting
branch: claude/research-broadcasting-integration-8p2DB
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-11
updated: 2026-03-11
labels: [broadcasting, social-media, ai, temporal, research]
external_refs:
---

# Broadcasting Platform Integration — Research Spike

## Context

> "If your startup isn't taking off, you need more marketing than coding."

Broadcasting — the ability for our AI to draft, schedule, and publish content across social platforms with human approval — is a strategic priority. This spike researches the most effective API-first integration paths, applies the Pareto principle to platform selection, and identifies OSS tools and Temporal workflow patterns for implementation.

## Research Findings

See full analysis: [docs/research/broadcasting-platform-integration.md](../../docs/research/broadcasting-platform-integration.md)

## Key Decisions Needed

1. **Build thin vs. adopt Postiz?** — Thin wrapper (~800 LOC) gives full control; Postiz gives a UI dashboard but adds operational burden (Redis, NestJS, Prisma).
2. **Which platforms for Crawl phase?** — Recommendation: Discord + Bluesky + X (free tiers, <1 day total integration).
3. **Temporal HITL granularity?** — Risk-based tiers (auto-post low-risk, block high-risk) vs. approve-all.

## Validation

- [ ] Research document covers all 8 target platforms with API details
- [ ] OSS tool comparison includes at least 2 self-hosted and 2 SaaS options
- [ ] Temporal HITL workflow design leverages existing scheduler infrastructure
- [ ] Crawl/Walk/Run roadmap with story-point estimates
- [ ] Architecture fit analysis maps to existing hexagonal layers
