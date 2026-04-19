---
id: bug.0327
type: bug
title: promote-build-payload silent abort + release-slot treats skipped verify as success — verify-candidate bypassed on real flight
status: needs_implement
priority: 1
rank: 5
estimate: 2
summary: In candidate-flight run 24620731840 (PR #922, 2026-04-19 04:14 UTC — first flight after PR #921 merged) `promote-build-payload.sh` wrote all four overlays and the deploy branch was pushed, but the script aborted silently between the last `promote_target` call and the `echo "promoted_apps=..." >> $GITHUB_OUTPUT` line. Result, `needs.flight.outputs.promoted_apps` was empty, `verify-candidate` was skipped via its job-level `if:` gate (working as designed per PR #921 / Axiom #11), but `release-slot.Decide lease state` collapsed `VERIFY_RESULT=skipped` into `status=success` — so the flight reported green despite having actually promoted four digests to `deploy/candidate-a` with zero verification that they ever reached running pods. This is exactly the silent-green class of bug PR #921 was written to eliminate, leaking through a path #921 did not cover, the *contradiction* between "flight promoted things" and "verify was skipped."
outcome: A flight that pushes promotions to `deploy/candidate-a` can never be green without verify-candidate passing. Silent aborts in `promote-build-payload.sh` between the final promotion and the `promoted_apps` emission are impossible — the output is written incrementally after each success and guaranteed via an EXIT trap.
spec_refs:
  - ci-cd-spec
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: fix/bug.0327-promote-silent-abort
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-19
updated: 2026-04-19
labels: [cicd, flight, silent-green, bug.0321-follow-up]
external_refs:
  - flight-run: https://github.com/Cogni-DAO/node-template/actions/runs/24620731840
  - umbrella: bug.0321
  - cousin: bug.0326
---

# promote-build-payload silent abort + release-slot treats skipped verify as success

## How this surfaced

PR-flight coordinator flighted PR #922 to candidate-a. Flight workflow reported
success; coordinator's extra Loki gate found no `buildSha` rollout-proof log
and no Argo Healthy-with-SHA evidence, which is expected because the entire
verification job was never executed.

Run [24620731840](https://github.com/Cogni-DAO/node-template/actions/runs/24620731840)
job outcomes:

| job                       | result  |
| ------------------------- | ------- |
| flight                    | success |
| verify-candidate          | skipped |
| release-slot              | success |
| report-no-acquire-failure | skipped |

Yet the `flight` job clearly ran all four `promote_target` calls and pushed
commit `6ec41df11 candidate-flight: pr-922 a377bad2026e…` to
`deploy/candidate-a` with all four overlay kustomization.yaml files changed.

## Smoking gun in the log

`promote-build-payload.sh`'s last log line is the fourth app's
`[INFO] Skipping commit (--no-commit). Caller manages git operations.`
(scheduler-worker). The script's final two lines —

```bash
echo "promoted_apps=${promoted_csv}" >> "$GITHUB_OUTPUT"
echo "Promoted apps: ${promoted_csv:-none}"
```

— never appeared. The step log jumped from the final `Skipping commit` to the
next step (`Commit and push deploy/candidate-a`) with a 35 ms gap. No error
message, no `↳ source-sha-by-app.json[...]` output from `update-source-sha-map.sh`
for any app, no stderr warnings. The script aborted between the last promotion
and the output-emission line. Under `set -euo pipefail` something in one of
`update_source_sha_map`'s bash/python invocations returned non-zero.

Root cause is environment-specific (candidate-a runner, whatever `source_sha`
parse behaviour produced an abort). Investigation continues, but the
_defense_ must not depend on the root cause, see below.

## Why it became silent green

`.github/workflows/candidate-flight.yml` `release-slot.Decide lease state`:

```bash
if [ "$FLIGHT_RESULT" = "success" ] && { [ "$VERIFY_RESULT" = "success" ] || [ "$VERIFY_RESULT" = "skipped" ]; }; then
  echo "state=free" >> "$GITHUB_OUTPUT"
  echo "status=success" >> "$GITHUB_OUTPUT"
```

`VERIFY_RESULT=skipped` is treated identically to `VERIFY_RESULT=success`.
That treatment is only valid when nothing was promoted, an empty
`promoted_apps` is the intended-skip signal per PR #921. When `promoted_apps`
is empty _because the promote step silently aborted_, the distinction
collapses and a real promotion goes unverified.

## Axioms violated

Two of the three axioms from PR #921's closeout in `docs/spec/ci-cd.md`:

- **Axiom 11** (verification is a job-level gate, never a step-level skip).
  Honored in letter, the verify-candidate skip was visible in the check list.
  Violated in spirit, `release-slot` re-collapses the visible skip into an
  invisible success.
- **Axiom 13** (artifact provenance travels with the artifact). The deploy
  branch carries the promoted digests. The step that emits
  `promoted_apps` is not atomic with the promotion itself — a single
  subshell failure detaches provenance from artifact.

## Minimal repro (for investigation, not the fix)

The production abort is hard to repro without the exact runner state. Local
repro of a _related_ silent-abort path, to validate the defensive fix:

```bash
# Make update_source_sha_map non-zero to simulate a post-promote abort.
mkdir -p /tmp/repro && cd /tmp/repro
# ... (see scripts/ci/tests/promote-build-payload.test.sh added by this fix)
PROMOTE_SCRIPT=/tmp/stub-promote.sh MAP_SCRIPT=/bin/false \
  PAYLOAD_FILE=payload.json OVERLAY_ENV=candidate-a \
  GITHUB_OUTPUT=out.txt bash scripts/ci/promote-build-payload.sh
# Before the fix, out.txt is empty. After the fix, out.txt contains
# promoted_apps=<CSV of the apps that were actually written before the abort>.
```

## Fix (this bug)

Three complementary changes. Individually each is a defense-in-depth, together
they make the silent-green class impossible for the verify-candidate gate.

### Fix A — `promote-build-payload.sh` incremental + trapped emission

1. After each successful `bash "$PROMOTE_SCRIPT"` call, record the app in
   PROMOTED and _immediately_ overwrite `promoted_apps=<current-csv>` into
   `$GITHUB_OUTPUT`. Last-write-wins in GH Actions.
2. Install `trap emit_on_exit EXIT`, which re-emits `promoted_apps` on the
   way out, regardless of success or abort.
3. Move `update_source_sha_map` into a **second pass** that runs after every
   promotion has been recorded. Wrap each call in `|| true` so a map-write
   failure does NOT prevent a correct `promoted_apps` emission.

Provenance (source-sha map) is preserved on the happy path. On the unhappy
path, `promoted_apps` always reflects what was actually written to overlays,
and the verify-candidate gate gets its correct input.

### Fix B — `release-slot` closes the contradiction

`VERIFY_RESULT=skipped` is only a valid success signal when
`flight.outputs.promoted_apps == ''`. Otherwise it's a contradiction, flight
promoted real things but verify never ran, which must hard-fail.

New decision matrix:

| flight  | verify  | promoted_apps | state  | status  |
| ------- | ------- | ------------- | ------ | ------- | ---------------------------- |
| success | success | any           | free   | success |
| success | skipped | empty         | free   | success |
| success | skipped | non-empty     | failed | failure | _(this row — contradiction)_ |
| success | failure | any           | failed | failure |
| failure | any     | any           | failed | failure |

### Fix C — `scripts/ci/tests/promote-build-payload.test.sh`

Deterministic repro harness. Runs three cases end-to-end against a
temp-dir overlay tree and stub PROMOTE_SCRIPT:

1. Happy path → `promoted_apps=operator,poly,resy,scheduler-worker`, map written.
2. MAP_SCRIPT failing (simulates the production abort) → `promoted_apps` still
   CSV of all four promoted apps (the fix), map is missing (acceptable —
   source-of-truth is overlay digests).
3. Zero digests in payload → `promoted_apps=` (empty), gate skip is genuine.

## Validation

1. `bash scripts/ci/tests/promote-build-payload.test.sh` passes all three cases
   on the fix branch and fails case 2 on main.
2. `pnpm check:docs` clean (the new bug item has the right schema).
3. Flight a no-op PR (one that doesn't change nodes/services) on this branch:
   verify-candidate legitimately skipped, release-slot green. Unchanged
   behaviour for the empty-promotion path.
4. Flight a real PR on this branch that touches one node: verify-candidate
   runs, passes, release-slot green. Happy path unchanged.
5. Ad-hoc proof of the contradiction gate: temporarily set
   `MAP_SCRIPT=/bin/false` via a workflow env override on a test branch,
   dispatch `candidate-flight.yml`, observe:
   - flight job: success
   - verify-candidate: runs (because `promoted_apps` is now non-empty despite
     the map-write failure)
   - If verify passes: release-slot green. If verify fails: release-slot red.
     Either way, no silent green.

## Follow-ups (not this bug)

- **Root-cause investigation**: why did `update_source_sha_map` (or whatever
  aborted) return non-zero on the candidate-a runner for PR #922? File as a
  separate follow-up after the defensive fix lands — current priority is
  closing the silent-green path, not diagnosing one production flake.
- **Stronger provenance check**: bug.0326 (wait-for-argocd digest-match) is
  the cousin — asserts the promoted digest actually appears in pod
  `containerStatuses[].imageID`. Complementary, not overlapping.
