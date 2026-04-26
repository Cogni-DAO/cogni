# First Ever Operator-Flighted Candidate Build

**Date:** 2026-04-24
**PR:** [Cogni-DAO/node-template#1034](https://github.com/Cogni-DAO/node-template/pull/1034) — `fix(poly): bug.0342 float round-trip + wallet total double-count`
**Workflow run:** https://github.com/Cogni-DAO/node-template/actions/runs/24902457894
**Head SHA:** `ffd56570`
**Triggered by:** `cogni-node-template[bot]` (the Operator's GitHub App)
**Model:** gpt-4o-mini, via `core__vcs_flight_candidate`

## What happened

For the first time, the Cogni Operator autonomously dispatched a `candidate-flight` workflow run on the `node-template` repo. Prior to this run, every one of the preceding 99 candidate-flight dispatches had been triggered by `derekg1729`. Run `24902457894` — triggered by `cogni-node-template[bot]` — is the first non-human flight in the repo's history.

Derek's instruction to the Operator was simply:

> sonarcloud not needed. flight

Other CI (unit, component, stack-test, CodeQL, all builds) was green; SonarCloud was the lone failure. The Operator judged the SonarCloud failure non-blocking per Derek's guidance and called `core__vcs_flight_candidate` on PR #1034.

## Why it matters

This is the proof-of-life moment for the Operator as an **agentic git-manager**. The product vision — the Operator as an AI git-manager for N DAO node repos — crossed from demo to real here. Candidate-a is the single-slot flight runway; the Operator now drives it.

## The loop, for posterity

1. `core__vcs_list_prs` → surface open PRs
2. `core__vcs_get_ci_status` on PR #1034 → all green except SonarCloud
3. Human input: "sonarcloud not needed. flight"
4. `core__vcs_flight_candidate` → dispatched
5. GitHub Actions: `cogni-node-template[bot]` shows as the trigger actor

## Receipts

```
$ gh api repos/Cogni-DAO/node-template/actions/runs/24902457894 --jq '.triggering_actor.login'
cogni-node-template[bot]
```

100th candidate-flight run. 1st by the Operator. 🚀

## Addendum — Codex executor still toolless

Same day, Derek asked the Codex graph executor to flight PR [#1012](https://github.com/Cogni-DAO/node-template/pull/1012) with the same "sonarcloud nonblocking" guidance. It could not.

The Codex executor reported:

> required tools are unavailable in this Codex graph executor: `core__vcs_get_ci_status`, `core__vcs_flight_candidate`, `core__repo_open`

So the maiden flight on PR #1034 stands — but it's backend-scoped: the VCS MCP tool surface is wired into the 4o-mini executor path, not yet into the Codex graph executor. Any Operator running through Codex is still a passenger, not a pilot.

**Next:** expose the VCS MCP tools (`core__vcs_*`, `core__repo_open`) to the Codex executor so flight parity holds across backends.

## Addendum 2 — Kimi-K2 flies on the standard graph executor

Derek re-homed the same request ("flight 1012, sonarcloud nonblocking") onto Kimi-K2 via the standard graph executor. It worked.

- **PR:** [Cogni-DAO/node-template#1012](https://github.com/Cogni-DAO/node-template/pull/1012) — `feat(poly): windowed wallet stats — batched endpoint + 60s cache`
- **Head SHA:** `c6ddb246`
- **Model:** Kimi-K2 (paid)
- **Tool surface:** `core__repo_open`, `core__vcs_get_ci_status`, `core__vcs_flight_candidate` — all available on the normal graph executor
- **CI state:** all green except SonarCloud (failure, treated as non-blocking per Derek)
- **Result:** flight dispatched, `candidate-flight.yml` triggered

So the Operator now has **two confirmed pilot models**: gpt-4o-mini and Kimi-K2. The distinguishing axis remains the executor (normal graph executor has the VCS tools; Codex graph executor still doesn't), not the model itself.

Pilot roster:

- 4o-mini (OpenAI) — PR #1034, 2026-04-24 ✅
- Kimi-K2 (paid) — PR #1012, 2026-04-24 ✅
- Codex — still grounded 🛑
