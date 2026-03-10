---
id: bug.0148
type: handoff
work_item_id: bug.0148
status: active
created: 2026-03-09
updated: 2026-03-09
branch: fix/bug-0147-attribution-correctness
last_commit: 0eab5da9
---

# Handoff: Attribution pipeline correctness — bot exclusion, credit misattribution, unpromoted PR inclusion

## Context

- Epoch #12 on preview (3/9–3/16) shows three attribution correctness failures discovered during the first live validation of the full attribution pipeline
- Cogni-1729 (automation GitHub User account) receives 97.1% of credit (33,000 points from 33 "release:" PRs)
- derekg1729 (human) receives only 2.9% (1,000 points) for PR #533 — which was never promoted to main
- The promotion-selection policy (`cogni.promotion-selection.v0`) was confirmed active in logs at 13:51Z with `included: 0, excluded: 28` — but the UI later shows 34 total points, meaning a subsequent collection cycle produced different results
- PR #534 (staging→main release) merged at 14:00:44Z; PR #533 (staging-only) merged at 14:01:29Z — PR #533's merge SHA is provably NOT in PR #534's 47 commits

## Current State

- **Bug filed**: `work/items/bug.0148.attribution-pipeline-correctness.md` — priority 0, three failures documented
- **Worktree created**: `fix/bug-0147-attribution-correctness` off staging — no code changes yet
- **Root cause for Failure 1 (bot exclusion)**: Confirmed — `github.ts:418-427` only checks `__typename !== "User"`, Cogni-1729 is a User account
- **Root cause for Failure 2 (credit misattribution)**: Confirmed — `platformUserId` is `pr.author.databaseId`, automation bot is the PR author
- **Root cause for Failure 3 (unpromoted PR inclusion)**: **UNCONFIRMED** — Grafana Cloud MCP was intermittent; could not trace PR #533's selection decision in logs. This is the critical unknown.

## Decisions Made

- Promotion-selection policy design: `packages/attribution-pipeline-plugins/src/plugins/promotion-selection/descriptor.ts` (merged in PR #521)
- Selection persistence uses `insertSelectionDoNothing` pattern: `services/scheduler-worker/src/activities/ledger.ts:625`
- Bot exclusion was explicitly out of scope in original design (only `__typename` check existed)

## Next Actions

- [ ] **FIRST**: Investigate Failure 3 — trace PR #533 through preview logs to determine exactly how it got `included=true`. Query: `{service="scheduler-worker", env="preview"} |~ "compact pnpm|533|3c75a844"` and check `epoch_selection` table for its receipt. The two hypotheses: (a) a collection cycle ran without the promotion policy, or (b) `insertSelectionDoNothing` preserved a stale `included=true` from before the promotion policy was deployed.
- [ ] Add `excludedLogins` config to GitHub adapter (source from repo-spec `.cogni/repo-spec.yaml`)
- [ ] Add exclusion guards in `normalizePr`, `normalizeReview`, `normalizeIssue` in `github.ts`
- [ ] Fix whatever caused Failure 3 (depends on investigation)
- [ ] Add unit tests: bot exclusion in `github-adapter.test.ts`, unpromoted rejection in `ledger-activities.test.ts`
- [ ] Longer-term: consider commit-level authorship for Failure 2 (out of scope for this bug)

## Risks / Gotchas

- Grafana Cloud MCP drops connection frequently — if it won't connect, check `/mcp` reconnect or query Loki directly via `curl` against the Grafana Cloud API
- The `insertSelectionDoNothing` pattern means once a selection row is written with `included=true`, it is NEVER overwritten by a subsequent run — if the initial run used `include-all` policy, later runs with `promotion-selection` won't fix it
- The scheduler-worker logs stop at 14:01Z — there may be a gap due to preview redeployment after PR #533 merged to staging; check for logs after ~14:10Z
- `excludedLogins` is fragile (login can change); `excludedPlatformUserIds` (GitHub numeric databaseId) is more stable but less readable — consider supporting both

## Pointers

| File / Resource                                                                       | Why it matters                                                                                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `services/scheduler-worker/src/adapters/ingestion/github.ts`                          | GitHub adapter — `normalizePr` (line 413), `normalizeReview` (line 530), `normalizeIssue` (line 638). Bot exclusion goes here.        |
| `packages/attribution-pipeline-plugins/src/plugins/promotion-selection/descriptor.ts` | Promotion policy — `buildPromotedShas` (line 32), `decideInclusion` (line 80). Determines what gets `included=true`.                  |
| `services/scheduler-worker/src/activities/ledger.ts`                                  | `materializeSelection` (line 538) — dispatches policy, writes selections via `insertSelectionDoNothing` (line 625). Key to Failure 3. |
| `packages/attribution-pipeline-plugins/src/profiles/cogni-v0.0.ts`                    | Active profile — confirms `selectionPolicyRef: PROMOTION_SELECTION_POLICY_REF`                                                        |
| `.cogni/repo-spec.yaml`                                                               | Repo config — add `excludedLogins` / `excludedPlatformUserIds` here                                                                   |
| `work/items/bug.0148.attribution-pipeline-correctness.md`                             | Full bug report with reproduction steps                                                                                               |
| Grafana Cloud LogQL                                                                   | `{service="scheduler-worker", env="preview"} \| json \| component="ledger"` — trace selection decisions                               |
