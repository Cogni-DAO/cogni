---
id: story.0248
type: story
title: "Dolt Branching CI/CD — experiment branches, A/B evaluation, confidence-gated promotion to main"
status: needs_design
priority: 3
rank: 5
estimate: 5
summary: "Evolve the single-branch Doltgres knowledge store into a branching workflow. Agents write experiments to feature branches, evaluation runs compare branch vs main, high-confidence improvements auto-merge to main. CI/CD pipeline manages branch lifecycle."
outcome: "Knowledge evolves through a git-like branching model. Experimental claims live on branches. Validated improvements merge to main automatically when confidence thresholds pass. Branch cleanup is automated."
spec_refs:
  - knowledge-data-plane-spec
assignees: derekg1729
project: proj.poly-prediction-bot
created: 2026-04-02
updated: 2026-04-02
---

# Dolt Branching CI/CD — Experiment → Evaluate → Promote

> Spec: [knowledge-data-plane](../../docs/spec/knowledge-data-plane.md) | Depends on: task.0231 (done)

## Context

task.0231 delivers single-branch Doltgres with commit/log/diff. The spec envisions branching for experiments, but defers it to post-MVP. This story designs and implements the branching workflow.

## Design Sketch

```
main                          ← production knowledge (high confidence)
  ├─ experiment/prompt-v4     ← agent tries new prompt wording
  ├─ experiment/base-rate-update ← new data updates a base rate claim
  └─ experiment/strategy-v2   ← modified strategy params

Evaluation:
  - Run analysis with branch knowledge vs main knowledge
  - Compare outcomes (accuracy, calibration, signal quality)
  - If branch outperforms by >N% with p<0.05 → auto-merge to main
  - If inconclusive after M runs → expire branch
  - If worse → discard branch
```

## Deliverables

- [ ] Add `checkout`, `merge`, `deleteBranch` to KnowledgeStorePort
- [ ] Branch naming convention: `experiment/{description}`
- [ ] Evaluation harness: run same analysis against branch vs main knowledge
- [ ] Confidence-gated merge: auto-merge when eval threshold passes
- [ ] Branch expiry: auto-delete stale experiment branches (>7 days, no merge)
- [ ] CI/CD: Temporal workflow for branch lifecycle management
- [ ] `dolt_push` to remote for backup (not cross-node sharing yet)

## Validation

```bash
pnpm check          # static checks
pnpm dev:stack      # dolt branching ops work in dev stack
```

## Non-Goals

- Cross-node knowledge sharing (future — requires x402)
- Manual merge resolution (auto-merge or discard only for MVP)
- Concurrent branch experiments on same claim (serialize for now)
