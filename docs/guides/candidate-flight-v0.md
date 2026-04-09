---
id: guide.candidate-flight-v0
type: guide
title: Candidate Flight V0 — Agent Guide
status: draft
trust: draft
summary: Short operational guide for flying one selected PR to the single candidate slot in the trunk-based CI/CD model
read_when: Reviewing or implementing the v0 candidate-flight flow, or advising on how to flight one PR to `candidate-a`
owner: cogni-dev
created: 2026-04-08
verified: 2026-04-08
tags: [ci-cd, gitops, candidate-flight, agents]
---

# Candidate Flight V0 — Agent Guide

> Use this guide for the boring MVP only: one slot, one selected PR, no merge queue.

## Rules

- `main` is the only long-lived code branch.
- The authoritative v0 artifact is the PR head SHA.
- `deploy/candidate-a` is a long-lived bot-written deploy ref.
- Do not auto-flight every green PR.
- A human explicitly chooses which PR to flight now.
- `candidate-flight` is authoritative only for PRs explicitly sent to flight.
- Standard CI/build checks remain the universal merge gate.

## Operator Flow

1. Confirm the PR is green on normal CI/build.
2. Confirm the PR is up to date with `main`.
3. Trigger flight explicitly: `flight-now` label or `workflow_dispatch`.
4. Read the lease on `deploy/candidate-a`.
5. If occupied, report `candidate-a busy` and stop. Do not queue.
6. If free or expired, acquire the lease.
7. Push the PR digest to `deploy/candidate-a`.
8. Let Argo sync the stable candidate environment.
9. Run the thin flight checks on the stable candidate URL.
10. Post one aggregate `candidate-flight` result.
11. Release the lease when finished or cancelled.
12. If the PR head changes, rerun flight on the new SHA.

## Required Prototype Checks

- healthy pods
- `/readyz` returns `200` on operator, poly, and resy
- `/livez` returns structured JSON on operator, poly, and resy

## Follow-On Checks

- auth or session sanity path
- one chat or completion path
- one scheduler or worker sanity path
- one or two node-critical APIs

## Hard Boundaries

- No merge queue in v0.
- No dynamic per-PR environments.
- No hidden queue or auto-priority logic.
- No second state plane beyond the lease file for slot truth.
- No rebuild after merge.

## Primary References

- [`docs/spec/ci-cd.md`](../spec/ci-cd.md)
- [`docs/spec/cd-pipeline-e2e.md`](../spec/cd-pipeline-e2e.md)
- [`docs/spec/candidate-slot-controller.md`](../spec/candidate-slot-controller.md)
