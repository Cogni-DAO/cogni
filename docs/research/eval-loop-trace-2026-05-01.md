---
id: eval-loop-trace-2026-05-01
type: research
title: "Eval-loop baseline trace — bug.5004 + bug.5005 happy-path dispatch (2026-05-01)"
status: active
trust: observed
summary: "Manual coordinator trace of two parallel dev-agent dispatches (bug.5004 poly normalizer + bug.5005 operator PATCH allowlist) walking the contribute-to-cogni lifecycle. Produces the seed assertion corpus for task.5004 (autonomous eval loop). Six concrete drift points logged for the synthetic harness to assert against."
read_when: Implementing task.5004 (synthetic eval harness); designing the qa-agent in task.0309; reviewing whether contribute-to-cogni / validate-candidate skills cover the happy-path lifecycle; debugging why an agent stalled mid-lifecycle.
implements:
owner: engineering-optimizer-skill
created: 2026-05-01
verified:
tags: [evals, lifecycle, contribute-to-cogni, validate-candidate, eval-loop-baseline, task.5004]
---

# Eval-loop Baseline Trace — 2026-05-01

> Manual coordinator (engineering-optimizer skill) tracking two parallel dev-agent dispatches through the lifecycle. The synthetic eval loop (`task.5004`) must encode every drift surfaced here as a runnable assertion.

## Dispatch Context

| Item     | Title                                                                                   | Node     | Surface           | Expected fix shape                          |
| -------- | --------------------------------------------------------------------------------------- | -------- | ----------------- | ------------------------------------------- |
| bug.5004 | Mirror picks wrong outcome on binary markets — token_id resolution diverges from target | poly     | normalizer module | Pass through target's `asset` unchanged     |
| bug.5005 | `work.items.patch.v1` allowlist missing `deployVerified` / `projectId` / `parentId`     | operator | API contract      | Extend allowlist; switch to `strictObject`  |

Both items existed in Doltgres on preview (`https://preview.cognidao.org/api/v1/work/items/`); both were triaged to `needs_implement` P1 by the coordinator before agent dispatch.

## Stage-by-Stage Trace

| # | Stage                                  | Skill / command                          | bug.5005 (Dev B)                                        | bug.5004 (Dev A)                                                 |
| - | -------------------------------------- | ---------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| 1 | Worktree off main                      | contribute-to-cogni Phase 1.1            | ✅ `derekg1729/fix-patch-deploy-verified`               | ✅ `derekg1729/poly-fill-token-passthrough`                      |
| 2 | Adopt existing work item               | Phase 1.2 (anti-sprawl)                  | ✅ adopted bug.5005                                     | ✅ adopted bug.5004                                              |
| 3 | PATCH `branch` on entry                | Phase 1.3                                | ✅ within ~1 min of dispatch                            | ✅ within ~1 min                                                 |
| 4 | Implement + tests                      | /implement; testing.md                   | ✅ contract test + adapter SQL-emit test                | ✅ (PR #1184 diff confirms; deeper read pending)                 |
| 5 | CI green pre-flight                    | Phase 2.5                                | ✅ all 18 required checks                               | ✅ all 16 required checks (cleared faster than Dev B)            |
| 6 | PATCH `pr` + `status:needs_closeout`   | Phase 1.3 + /closeout                    | ✅ both fields PATCHed in correct order                 | ⚠️ `pr` set while `status` still `needs_implement` for ~5 min    |
| 7 | Flight to candidate-a                  | Phase 2.8 (`POST /api/v1/vcs/flight`)    | ✅ buildSha confirmed match (`9b4d529b…`)               | ⏳ paused by coordinator (slot serialized behind bug.5005)       |
| 8 | Self-validate per validate-candidate   | Phase 3.10–11; validate-candidate skill  | ✅ positive PATCH (200 + persisted) + negative (400 + key surfaced) + buildSha + Loki query referenced | ⏳ pending unpause |
| 9 | PR comment with scorecard              | Phase 3.12; validate-candidate §7        | ✅ posted at 23:35:19Z, format-compliant (API-only — HUMAN axis correctly N/A) | ⏳ pending |
| 10 | Mark ready for review                 | Phase 4.14                               | ⏳ awaiting human                                       | (—)                                                              |
| 11 | Merge → PATCH `status:done`            | Phase 4.16                               | ⏳ awaiting human merge                                 | (—)                                                              |
| 12 | PATCH `deployVerified:true` (final)    | **Not in any skill** (gap)               | ⚠️ Dev B PATCHed deployVerified=true as a *test of the fix* during validation; ambiguous whether that doubled as the lifecycle finalization | ⏳ |

## Drift Points → Synthetic Eval Assertions

> Each row is a runnable assertion the `task.5004` harness must encode. Format: trigger condition → expected behavior → current behavior.

### D1 — `pr` set while `status==needs_implement`
**Trigger:** PATCH `{pr:"<url>"}` on a work item with `status==needs_implement`.
**Expected:** server rejects with 4xx OR auto-advances `status` to `needs_closeout`.
**Observed:** silently accepted; status drifts for arbitrary time until agent remembers to PATCH it.
**Fix surface:** `nodes/operator/app/src/adapters/server/db/doltgres/work-items-adapter.ts` (status state-machine in PATCH handler, or contract refinement).

### D2 — No skill-invocation audit trail
**Trigger:** agent posts a PR comment matching the validate-candidate scorecard format.
**Expected:** harness can prove the agent loaded `.claude/skills/validate-candidate/SKILL.md` before producing the comment (Skill-tool invocation log).
**Observed:** no log; format-match is the only signal — could be coincidence or coordinator-prompt seeding.
**Fix surface:** harness instrumentation; not a code-side fix.

### D3 — `deployVerified:true` finalization is uncodified
**Trigger:** PR merges + buildSha includes the merge commit on the canonical env (preview/prod).
**Expected:** an explicit step (skill section or post-merge automation) PATCHes the work item `{deployVerified:true}`.
**Observed:** `contribute-to-cogni` Phase 4 stops at `status:done`; `validate-candidate` skill explicitly says "no work-item frontmatter edits" (a stale rule from the markdown-corpus era — Doltgres makes the PATCH the canonical signal).
**Fix surface:**
- Add Phase 5 to `contribute-to-cogni`: PATCH `{deployVerified:true}` after merge + buildSha confirmation.
- Update `validate-candidate` to remove the no-frontmatter-edits rule for Doltgres-stored items (the rule predates the API).

### D4 — Single-occupancy flight slot, no harness for serialization
**Trigger:** two PRs are simultaneously flight-eligible.
**Expected:** operator API rejects the second `POST /api/v1/vcs/flight` with `slot_busy` until the first lease releases, OR a queue / lease primitive serializes them.
**Observed:** coordinator (human or skill) holds the slot manually; without a coordinator, both flights would clobber.
**Fix surface:** flight-lease primitive on `nodes/operator/app/src/app/api/v1/vcs/flight/route.ts` (already partially designed in promote-skill; needs surfacing).

### D5 — Coordinator prompts not skill-anchored
**Trigger:** coordinator dispatches a dev-agent on a work item.
**Expected:** prompt references `.claude/skills/contribute-to-cogni/SKILL.md` + `.claude/skills/validate-candidate/SKILL.md` + node-skill by path; only adds dispatch-specific delta.
**Observed:** today's dispatches re-explained the lifecycle inline, polluting the audit trail and risking agent drift.
**Fix surface:** coordinator-prompt template (now memorialized in `feedback_eval_loop_coordinator_drift.md`); could be elevated to a `coordinator-dispatch` skill.

### D6 — validate-candidate skill weight for surgical bugs
**Trigger:** PR is single-axis (API-only or UI-only, no graph/family/cross-surface).
**Expected:** lightweight scorecard variant in the skill — single row, single-axis, optional family-sub-matrix.
**Observed:** skill is dense (~300 lines, multiple matrix flavors). Dev B produced a correct minimal scorecard, but only because the surgical case happened to map cleanly to "API-only ⇒ HUMAN n/a".
**Fix surface:** `.claude/skills/validate-candidate/SKILL.md` — add an explicit "single-axis surgical" path-shortener at the top.

### D7 — Lifecycle validates the FIX, not the BUG ⚠️ HIGHEST-VALUE
**Trigger:** any work item where the bug-as-described is not the bug-as-real (misdiagnosis at intake/triage).
**Expected:** an early lifecycle gate (likely `/triage` or `/research`) requires a **reproduction proof** before the bug exits `needs_triage` — a falsifiable assertion the bug exists, with the verification command + expected output.
**Observed:** bug.5004 was filed with a description that prescribed the fix ("pass through asset unchanged"). Triage routed it directly to `needs_implement` (correctly per the new skip-design rule because the fix appeared surgical). Dev A implemented exactly that fix. PR went CLEAN through CI. Validate-candidate skill *cannot catch this* because the skill validates that the deployed fix matches the validation contract — it has no axis for "is the validation contract framed against a real bug?" The on-chain truth (tx 0x8822381b… mirrors target's actual trade; the wrong-outcome hypothesis was based on a Data-API visibility quirk) was only discovered post-PR by an independent code reviewer.
**Cost paid today:** ~3+ hours of Dev A engineering time + reviewer time + coordinator (this session) bandwidth, on a fix that's tautological under current code. Real bug (sizing asymmetry, target median $4.33 / p99 $1,333 vs our ~$5 cap) remains live and continues to bleed money.
**Fix surface — multiple, ordered by leverage:**
1. **Add a `Reproduction` block to `/bug` template + bug-creation contract.** The bug body must include a reproducible assertion: a command/query + expected output that proves the bug exists *before* the fix lands. For bug.5004 the missing assertion was: "decode tx 0x8822381b… on-chain; expect TransferSingle TO recipient ≠ RN1 (proves wrong-outcome pipeline)." That assertion would have failed at intake — bug never gets filed.
2. **`/triage` must validate the reproduction.** Before routing to `needs_implement`, the agent runs the `Reproduction` command and confirms expected output. Routes to `needs_research` if reproduction fails or is absent.
3. **Eval-loop assertion:** synthetic harness must include a `bug-validity` axis — given a synthetic bug whose description is wrong (e.g. "the API returns 500 on /foo" but it actually returns 200), the harness must surface the misdiagnosis at `/triage` time, not after PR open.
4. **Skill edit:** add a `Reproduction Required` section to `.claude/commands/bug.md` and `.claude/commands/triage.md`. Update `/idea` template too if it can produce bugs.
**This is the eval-loop project's highest-value assertion.** Without it, every misdiagnosed bug burns full lifecycle cost before the truth surfaces.

### D8 — Concurrent writes with no coordination
**Trigger:** two actors PATCH the same work item within the optimistic-concurrency window.
**Expected:** server enforces `expectedRevision` (or last-writer-wins is documented and logged) so writes are auditable.
**Observed 2026-05-01 00:04Z:** coordinator PATCHed bug.5004 `{status:"cancelled", outcome:"MISDIAGNOSIS…"}`; ~30s later a second actor PATCHed `{status:"done"}`. The `outcome` field survived (the second writer didn't clear it), but `status` was clobbered. No principal log records who wrote what (per D9-equivalent gap — agent identity / revocation already on the engineering matrix). Status enum also lacks `not_a_bug` / `wont_fix` — `cancelled` is the closest, but it has been used by other agents to mean "scope dropped," so signal is muddled.
**Fix surface:**
1. Add `expectedRevision: number` (optional) to `work.items.patch.v1`; server returns 409 on mismatch.
2. Add `not_a_bug` and `wont_fix` to the status enum so closing-as-misdiagnosis has a distinct terminal state from closing-as-shipped.
3. (Cross-link: requires `proj.agent-identity-revocation` to record who wrote what.)

## Today's Result Summary (2026-05-01)

- **bug.5005** — happy path complete. Real bug, real fix, validated end-to-end on candidate-a. Bootstrap moment: the fix flipped its own `deployVerified=true`. Awaiting human review/merge as of EOD.
- **bug.5004** — full happy-path lifecycle ran on a non-bug. PR #1184 closed; bug status → `cancelled` with on-chain verification linked. Real divergence reframed under `task.0347` (per-tenant wallet preferences + copy-trade sizing). RN1 mirror remains disabled.
- **task.5004** — eval loop scope expanded: D7 added (reproduction-gate at /triage). D7 alone justifies the project against today's wasted effort.

## Acceptance for `task.5004`

The synthetic eval loop is "working" when, on a fresh OpenClaw container with a synthetic toy bug, the harness:

1. Walks the lifecycle by invoking the existing skills (with logged Skill-tool calls).
2. Asserts D1–D4 explicitly per stage transition.
3. Posts a final scorecard to the operator PR that triggered it.
4. Goes red on a known-broken main (e.g. revert the bug.5005 fix → assertion D3 fails at the `deployVerified:true` step).
5. Goes green within 5 min on a healthy main.

D5 and D6 are coordinator/skill-side fixes — out of scope for the eval-loop graph itself but raise its yield.

## Pointers

- Work items: `bug.5004`, `bug.5005`, `task.5004` — all in Doltgres on preview
- PRs: [#1183](https://github.com/Cogni-DAO/node-template/pull/1183) (bug.5005), [#1184](https://github.com/Cogni-DAO/node-template/pull/1184) (bug.5004)
- Charter regrade: [`work/charters/ENGINEERING.md`](../../work/charters/ENGINEERING.md) (matrix updated 2026-05-01)
- Coordinator drift memo: `feedback_eval_loop_coordinator_drift.md` (engineering-optimizer memory)
- Lifecycle spec: [`docs/spec/development-lifecycle.md`](../spec/development-lifecycle.md) (skip-design rule codified 2026-05-01)
- Validate-candidate skill: [`.claude/skills/validate-candidate/SKILL.md`](../../.claude/skills/validate-candidate/SKILL.md)
- Contribute-to-cogni skill: [`.claude/skills/contribute-to-cogni/SKILL.md`](../../.claude/skills/contribute-to-cogni/SKILL.md)
