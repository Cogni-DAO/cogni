---
name: contribute-to-cogni
description: E2E contributor contract for external agents submitting code to Cogni. Load this first. Covers the full lifecycle from worktree setup through candidate-a validation and PR acceptance. Use whenever an agent is contributing code to this repo.
---

# Cogni Contributor Contract

You are an external agent contributing code. Work is only accepted after **all 4 phases** complete.

At each phase: search the resource roots below for the relevant guides, specs, and skills — they exist. Follow them. Return to this loop.

## Resource Roots

- `.claude/skills/` — executable skills
- `.claude/commands/` — slash commands
- `work/charters/` — project charters and scope
- `work/items/` — work items (find yours or create one)
- `docs/guides/` — how-to guides
- `docs/spec/` — architecture and design specs
- `docs/runbooks/` — operational procedures

---

## Phase 1 — Implement

1. Worktree off `main`. Read `CLAUDE.md` and the `AGENTS.md` files for every dir you'll touch.
2. Find your work item in `work/items/` (or create one). Identify your **validation checklist** — the exact endpoint or behavior you will prove on candidate-a — before writing any code.
3. Find and follow the relevant lifecycle skills: `/triage → /design → /review-design → /implement → /closeout`. Two real off-ramps live in this chain — neither is a formality:
   - **`/triage`** locates the relevant charter (`work/charters/`) and existing work items, then prioritizes against them. A valid triage outcome is a **pivot**: drop this idea for a lower-priority slot, redirect to a similar/related work item already in flight, or escalate as a request for a new node project direction. Don't assume your incoming idea survives triage — let it lose to higher-priority work when that's the right call.
   - **`/review-design`** catches over-scoped designs. If `/design` lands a multi-PR plan, the review simplifies down to the **MVP first slice** and captures at most 1–2 follow-ups inside the same task/project. Do **not** fan out into new work items.
4. `pnpm check:fast` must pass. Push branch. `gh pr create` with a conventional commit title.

## Phase 2 — Flight Request

5. Wait until all required CI checks are green on your PR head SHA.
6. Discover the operator: `GET https://test.cognidao.org/.well-known/agent.json`
7. Register: `POST /api/v1/agent/register { "name": "<your-agent>" }` → `apiKey`
8. Request flight: `POST /api/v1/vcs/flight { "prNumber": N }` → 202 or 422 (CI not green).

## Phase 3 — Self-Validate

9. Wait for the `candidate-flight` check to appear on your PR head.
10. Execute your Phase 1 validation checklist against `https://test.cognidao.org`.
11. Query Loki for your request at the deployed SHA.
12. Post a PR comment with: endpoint hit, response received, Loki line. This is the real gate.
13. If validation fails: fix, push, repeat from Phase 1. Stale PRs with failed validation are closed.

## Phase 4 — Ready for Review

14. Mark PR "ready for review" only after the validation comment is posted and green.
15. Cogni operator reviews and merges.

---

**PRs are never "ready for review" before Phase 3 is complete.**
