---
id: spike.0234
type: spike
title: "Research: Premium frontend UX — activity stream, work items, agent visualization"
status: done
priority: 1
rank: 1
estimate: 1
summary: "Research how to deliver top-tier frontend UX for chat activity stream, work items table, and agent visualization. Survey OSS options (TanStack Table, Rive, Three.js). Produce research doc + project + task breakdown."
outcome: "Research document with findings and recommendations. proj.premium-frontend-ux created with 5 work items across P0-P2."
spec_refs:
assignees:
  - derekg1729
credit:
project: proj.premium-frontend-ux
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-30
labels: [ui, ux, research]
external_refs:
  - docs/research/ux-premium-frontend.md
---

# Research: Premium Frontend UX

## Findings

See [docs/research/ux-premium-frontend.md](../../docs/research/ux-premium-frontend.md) for full research document.

## Summary

- **Chat activity**: StatusEvent pipeline exists end-to-end but frontend doesn't render it. 1-line status ticker above composer is the fix (~50 LOC).
- **Work items**: Replace hand-rolled table with @tanstack/react-table. Add detail panel, keyboard nav.
- **Agent visualization**: Progressive — CSS animations → Rive/Lottie 2D avatars → Three.js 3D observatory.
- **Created**: proj.premium-frontend-ux with task.0235, task.0236, task.0237, task.0238, spike.0239.

## Validation

Research spike — no code changes. Validated by review of research document and work items.
