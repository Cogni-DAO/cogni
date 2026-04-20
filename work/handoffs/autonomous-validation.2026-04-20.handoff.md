---
id: autonomous-validation.2026-04-20.handoff
type: handoff
work_item_id: task.0345
status: active
created: 2026-04-20
updated: 2026-04-20
branch: chore/autonomous-validation-baton-pass
last_commit: pending
---

# Handoff: autonomous pass on Gate A + Gate B validation

## TLDR

User (Derek) handed off: "lock in the hard end validation — external agent flights a PR to candidate-a via public gitcogni API AND agent-api-validation with a PAID Kimi K2 run from a fresh wallet the agent funds itself." Then said "be off, see this through."

**Honest result: I could not complete either gate autonomously.** Both are gated on things only Derek can do (DAO formation, USDC funding, canary VM provisioning) or already-known blockers (preview running stale code; canary not deployed). This PR captures what I validated, what I found, and the exact next moves.

## What I did validate

| Surface                                                     | State                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/ai-tools/src/capabilities/vcs.ts` on main         | ✅ VcsCapability shipped (listPrs/getCiStatus/mergePr/createBranch) via PR #687 (2026-04-02) |
| `nodes/operator/.../github-vcs.adapter.ts` on main          | ✅ Octokit-backed GitHub App adapter live                                                    |
| `langgraph:pr-manager` graph in `packages/langgraph-graphs` | ✅ Registered, uses core\__vcs_\* tools                                                      |
| PR #955 (external-agent skill + Gate A/B runbooks)          | ✅ Open, content-complete. Stacked on canary PR #948 → CI red on lockfile drift              |
| `task.0344` (POST /api/v1/vcs/flight-candidate)             | ❌ Not started. Spec exists on PR #955. No main branch implementation.                       |
| `.well-known/agent.json` on main                            | ⚠️ Exists, lacks the `guides.externalAgentOnboarding` pointer (added in PR #955)             |
| `preview.cognidao.org/api/v1/agent/register`                | ❌ 401 on anonymous POST — see bug.0336 (filed in this PR)                                   |
| `preview.cognidao.org/readyz`                               | 200, `version: "0"` (BUILD_SHA unset — bug.0326 family)                                      |
| `canary-candidate-a.cognidao.org`                           | ❌ DNS does not resolve — DAO + VM not provisioned yet                                       |
| Source SHA preview is running                               | `c9d7cd520` (4 commits behind `main` tip `3bb61350a`)                                        |

## Gate A (external-agent PR lifecycle) — blocker matrix

| Blocker                                                         | Owner     | Gate-blocker | Notes                                                                      |
| --------------------------------------------------------------- | --------- | ------------ | -------------------------------------------------------------------------- |
| `task.0344` shipped (`POST /api/v1/vcs/flight-candidate`)       | ANY agent | Hard         | Clean-branch implementation possible today on `main`, no canary dependency |
| Canary deployed to `canary-candidate-a.cognidao.org`            | Derek     | Hard         | Requires: DAO formation (6 browser clicks in Privy/Aragon) + VM provision  |
| `task.0342` shipped (`ai-only-repo-policy` + `canary-bot[bot]`) | ANY agent | Hard         | Requires canary-bot GitHub App to be created first (browser step)          |
| `task.0338 part 2` shipped (Caddy + provision for canary)       | ANY agent | Soft         | Part 1 is PR #948 (lockfile drift); Part 2 is the remaining infra plumbing |
| PR #946 → #947 → #948 → #955 merged                             | Derek     | Soft         | Clicks only, but must unblock CI drift first (canary lockfile)             |

**Critical path:** Derek does the DAO + wallet steps (browser), merges #946 → #955, then ANY agent (human or otherwise) ships task.0344, then Gate A is runnable.

## Gate B (paid agent validation) — blocker matrix

| Blocker                                                     | Owner   | Gate-blocker | Notes                                                                      |
| ----------------------------------------------------------- | ------- | ------------ | -------------------------------------------------------------------------- |
| `bug.0336` resolved (preview register returns 201, not 401) | ANY dev | Hard         | Filed in this PR. Likely `AUTH_SECRET` missing or Caddy rule or stale pod. |
| `moonshot/kimi-k2-*` routed through LiteLLM on preview      | ANY dev | Hard         | Check `infra/compose/runtime/configs/litellm.config.yaml` has a Kimi entry |
| $2 USDC on Base sent to fresh agent wallet                  | Derek   | Hard         | One wallet action — can't be done autonomously (no funded agent wallet)    |
| `payments.status: active` on target node's repo-spec        | Varies  | Hard         | Operator preview should already be active; canary needs DAO formation      |

**Critical path:** Fix preview's 401 → confirm Kimi routed → Derek sends $2 USDC → run GATE_B runbook.

## Alternate minimum-viable proof run (free model, preview only)

If Derek wants proof of the agent-api flow WITHOUT paying, once bug.0336 is fixed:

```bash
export BASE=https://preview.cognidao.org
CREDS=$(curl -fsS -X POST $BASE/api/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name":"free-flow-proof"}')
export API_KEY=$(echo $CREDS | jq -r .apiKey)

curl -fsS -X POST $BASE/api/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","graph_name":"poet","messages":[{"role":"user","content":"haiku about baton passes"}]}' \
  | jq .choices[0].message.content
```

Same shape as GATE_B, no money at risk. Good 95%-confidence gate before funding the Kimi run.

## Deliverables in this PR

- `work/items/task.0242.vcs-tool-plane-pr-manager.md` — `needs_merge` → `done` with status note (merged via #687 2026-04-02)
- `work/items/bug.0336.preview-agent-register-401.md` — new bug report with repro, hypotheses, triage steps
- `work/handoffs/autonomous-validation.2026-04-20.handoff.md` — this file

## What I deliberately did NOT ship

- **task.0344 implementation.** Spec is clean on PR #955 but the impl is ~400 LOC across interface + adapter + route + contract + tests. Attempting it in remaining context budget would leave broken code on a branch — worse than leaving the work visibly not-started. Opening up a dedicated PR for task.0344 after #955 lands is the right path.
- **Execution of either Gate against anything.** Preview is broken (bug.0336), canary doesn't exist, and paid Kimi needs Derek-funded USDC. Running GATE_A or GATE_B right now would only produce failure logs that duplicate what this handoff says.

## Recommended next moves (Derek)

1. **Do the 6 browser/wallet clicks** in `docs/runbooks/CANARY_DAO_FORMATION.md` (per prior handoff) — unblocks canary infrastructure.
2. **Fix bug.0336** (probably 10 min: verify `AUTH_SECRET` on preview pod, re-deploy preview). Unblocks Gate B runbook.
3. **Merge #946 → #947 → #948 → #955** after resolving canary's lockfile drift. Likely `pnpm install` on the canary scaffold branch + re-push.
4. **Assign task.0344 to a fresh agent session** once #955 is merged. Fresh context = full 200K budget = confident implementation.
5. **Send $2 USDC on Base** to the agent wallet that GATE_B step 1 mints. Then run the full GATE_B runbook.

## Related

- [task.0242](../items/task.0242.vcs-tool-plane-pr-manager.md) — now `done`
- [task.0344](https://github.com/Cogni-DAO/node-template/pull/955/files#diff-task-0344) — spec on PR #955
- [task.0345](https://github.com/Cogni-DAO/node-template/pull/955/files#diff-task-0345) — Gate A/B criteria on PR #955
- [bug.0336](../items/bug.0336.preview-agent-register-401.md) — preview register 401
- [PR #955](https://github.com/Cogni-DAO/node-template/pull/955) — external-agent skill + runbooks (stacked, CI red on lockfile)
