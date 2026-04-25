# Handoff — `/validate-candidate` v1 → next dev

> **Branch:** `feat/candidate-auth-playwright` · **PR:** [#1038](https://github.com/Cogni-DAO/node-template/pull/1038)
> **Status:** rebased on `origin/main`, `pnpm check:fast` clean, ready for review/merge.
> **Author:** derekg1729 + Claude (2026-04-24 → 2026-04-25)

## What this PR ships

Three building blocks for closing the `deploy_verified` loop on candidate-a flights:

1. **`docs/guides/candidate-auth-bootstrap.md`** + **`scripts/dev/capture-authed-state.mjs`** — one-time per-dev primitive to capture an authed Playwright `storageState` for `<env>.cognidao.org`. Uses CDP-attach against a dedicated Chrome profile under `.local-auth/` (gitignored). Human effort: install MetaMask once, sign in once per env. The `storageState.json` is the durable artifact.
2. **`scripts/dev/smoke-authed-state.mjs`** — smoke-check a captured state still authenticates.
3. **`.claude/skills/validate-candidate/SKILL.md`** — the skill itself. Walks an agent through: load PR context → confirm `/version.buildSha` matches PR head per impacted node → enumerate impacted surfaces → exercise each on **Human (playwright-cli) + Agent (API) axes** → query Loki for own-request observability → post a locked-format scorecard as a PR comment.
4. **`work/items/bug.0369.reown-walletconnect-origin-allowlist-per-env.md`** — surfaced during the first live skill run; orthogonal but worth tracking. (Originally bug.0368, renumbered post-rebase due to collision with the migrator bug merged via PR #1041.)

The skill's first live run on PR #1033 caught two real drift bugs (`poly-research` graph registered but not executable; not exposed in chat UI) — proof the dual-axis matrix works.

## Your mission — replace `smoke-candidate.sh` LLM hack with Playwright smoke

`scripts/ci/smoke-candidate.sh` lines ~58–114 contain a hand-rolled bug.0322 cross-node isolation check that POSTs a real `gpt-4o-mini` chat completion via the `poet` graph on every flight. This is gnarly:

- **Couples flight gating to external LLM uptime.** Observed exit-28 curl timeouts have failed flights regardless of PR diff (PR #1012 flight run 24874508475, 2026-04-24).
- **Burns OpenRouter spend per flight.** Real money for a smoke check.
- **Tests the wrong layer.** What we actually want to know: "did the deployed pod respond to a representative authed request?" — not "is GPT-4o-mini available right now?"

`proj.cicd-services-gitops.md` row 15 explicitly calls for moving this assertion into the real E2E (Playwright) when parity lands and deleting the curl block. This handoff is the bridge to that work.

### Concrete first step

Inside `candidate-flight.yml` (or a follow-up `verify-candidate-playwright.yml` that runs after deploy converges), replace the bug.0322 block with a Playwright smoke that uses the **same captured-storageState pattern this PR establishes**:

```bash
# pseudocode for the CI step
playwright-cli -s=verify state-load .local-auth/candidate-a-poly.storageState.json
playwright-cli -s=verify open https://poly-${DOMAIN}/chat
playwright-cli -s=verify snapshot
# assert poly-brain (or another known-good graph) is in the agent picker
# optionally trigger one minimal chat turn against a free-tier model
playwright-cli -s=verify close
```

Two design choices the next dev needs to make:

1. **Where does the storageState come from in CI?** Capture is interactive; CI is not. Two options:
   - Vault-backed: store the JSON in a GitHub Actions secret, write to `.local-auth/` at job start, drop it at job end. Simplest.
   - Service-account auth: the operator/poly nodes already accept machine bearer tokens via `getSessionUser` → `resolveRequestIdentity` (see `nodes/poly/app/src/app/api/v1/agent/runs/route.ts` comment). Skip Playwright entirely for CI smoke; use the bearer-token agent-API flow from `docs/guides/agent-api-validation.md`. Probably the right answer for the regression-check use case — Playwright is for the Human-axis smell test, API is for the regression test.
2. **What to assert.** The bug.0322 LLM-completion check is testing run-isolation (poly's run isn't visible on operator's `/agent/runs`). Same assertion holds without an LLM call: register a machine agent on poly, mock a run record via the internal API, query both nodes' `/agent/runs`. No external LLM dependency.

### Suggested sequence

1. **File a task** under `proj.cicd-services-gitops` titled "replace smoke-candidate bug.0322 LLM check with Playwright smoke + run-isolation API assertion". Reference: this handoff, project row 15, this PR's skill as the auth pattern.
2. Decide between vault-backed storageState vs machine-bearer-token CI auth. My lean: machine-bearer-token for CI gating (cheap, deterministic, no LLM dep), and keep the `playwright-cli` flow for _agent-driven_ `/validate-candidate` runs (which are post-flight and human-or-agent-initiated, not blocking deploy).
3. Wire the new check into `candidate-flight.yml` behind a feature flag, run it in parallel with the old `smoke-candidate.sh` check for one or two PRs to confirm parity, then delete the old block.

## Known sketchy things in this PR (don't be surprised)

- **Test wallet seed is in `.local-auth/credentials.md` plaintext.** Gitignored. One `git add -A` from being wrong. Long-term should live in 1Password CLI / Doppler / similar. Acceptable for an MVP-stage test wallet; not acceptable for a real wallet.
- **`.local-auth/chrome-profile/` is in-repo.** Hundreds of MB. Should move to `~/.cogni-auth/chrome-profile/` next iteration. See `docs/guides/candidate-auth-bootstrap.md` "Future state" callout.
- **CDP-attach to real Chrome is fragile.** macOS-only launch command, Chrome 136+ already had to work around. Future Chrome versions will probably break this pattern again.
- **No expiration detection.** `smoke-authed-state.mjs` checks body markers, weak signal. Should hit an authed API and assert 200 with real data.

These are all called out in the guide's troubleshooting section and the future-state pointer. Tracked under `proj.agent-dev-testing.md` Run (P2+).

## Repo locations to know

| WHAT                                                       | WHERE                                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Skill (locked-format scorecard)                            | `.claude/skills/validate-candidate/SKILL.md`                                                       |
| Auth bootstrap guide                                       | `docs/guides/candidate-auth-bootstrap.md`                                                          |
| Capture script                                             | `scripts/dev/capture-authed-state.mjs`                                                             |
| Smoke verifier                                             | `scripts/dev/smoke-authed-state.mjs`                                                               |
| Captured state (gitignored)                                | `.local-auth/candidate-a-<node>.storageState.json`                                                 |
| Loki query helper (used by skill)                          | `scripts/loki-query.sh`                                                                            |
| The hack to retire                                         | `scripts/ci/smoke-candidate.sh` lines 58–114                                                       |
| Existing E2E roadmap                                       | `proj.agent-dev-testing.md` Run (P2+)                                                              |
| Existing CI E2E gap                                        | `proj.cicd-services-gitops.md` row 15                                                              |
| First successful skill run                                 | [PR #1033 scorecard](https://github.com/Cogni-DAO/node-template/pull/1033#issuecomment-4316368629) |
| QA-agent graph (eventual replacement for the manual skill) | `work/items/task.0309.qa-agent-e2e-validation.md`                                                  |

## What I'd do first if I were picking this up

1. Read the PR #1033 scorecard comment — that's the proof the skill works and shows the matrix layout you're targeting.
2. Run the auth bootstrap once locally: capture `candidate-a-poly` and `candidate-a-operator` storageStates, run `pnpm check:fast`, confirm `smoke-authed-state.mjs` reports both as authed.
3. Open `scripts/ci/smoke-candidate.sh`, read lines 50–114, decide whether the bug.0322 assertion belongs in (a) the new Playwright smoke, (b) a pure-API run-isolation test, or (c) both at different layers. Lean (b) per the design notes above.
4. File the follow-up task and link this handoff.

Good luck.
