---
id: task.0374
type: task
title: "Catalog-as-SSoT — make infra/catalog/*.yaml the single node declaration"
status: needs_merge
priority: 0
rank: 1
estimate: 4
branch: feat/catalog-ssot-pivot
summary: "Pivot before task.0372: make `infra/catalog/*.yaml` the single source of truth for the node list. Every CI/infra consumer that today hardcodes `(operator poly resy scheduler-worker)` (image-tags.sh, detect-affected.sh, wait-for-argocd.sh, compose, future bootstrap script) reads catalog instead. Adding a node collapses from a 10-file edit to a 3-step PR (drop catalog yaml + write Dockerfile + add overlay)."
outcome: "After this task, `infra/catalog/*.yaml` is the only place a node is declared. `scripts/ci/lib/image-tags.sh` reads it. `scripts/ci/detect-affected.sh` reads it (path_prefix → target). `scripts/ci/wait-for-argocd.sh`'s default APPS list reads it. Compose generation (or its CI doc) references it. A new lint check (`scripts/ci/check-catalog-ssot.sh`) fails CI when any consumer references a node not present in catalog. task.0372's Layer 1 bootstrap script (push 12 deploy branches) becomes a one-liner over `infra/catalog/*.yaml`."
spec_refs:
  - ci-cd
assignees: []
project: proj.cicd-services-gitops
pr: https://github.com/Cogni-DAO/node-template/pull/1053
created: 2026-04-25
updated: 2026-04-25
labels: [ci-cd, infra, ssot, task.0372-blocker]
external_refs:
  - work/items/task.0372.candidate-flight-matrix-cutover.md
  - work/projects/proj.cicd-services-gitops.md
---

# task.0374 — Catalog-as-SSoT pivot

## Why this lands before task.0372

Reviewer note (2026-04-25, on task.0372 PR-prep): _"Pivot to catalog SSoT this week, before 0372. … After SSoT lands, 0372's Layer 1 bootstrap script becomes a one-liner iterating `infra/catalog/*.yaml`. That's the multiplier you want before adding nodes."_

The matrix cutover (task.0372) is currently parameterized by hardcoded node lists scattered across CI scripts and YAML. Shipping it on top of duplicated lists doubles the migration cost: every per-node branch, every matrix `include`, every `wait-for-argocd APPS` list, every `detect-affected` path-prefix arm has to be edited each time a node lands or leaves. With a real SSoT, the matrix shape derives from one `ls infra/catalog/*.yaml` glob. **Defer task.0372 PR open. Land this first.**

## Current state — duplicated node-list sites (audit)

| Site                                                                           | What it hardcodes                                                                                                                       | Drift evidence                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `scripts/ci/lib/image-tags.sh`                                                 | `ALL_TARGETS=(operator poly resy scheduler-worker)`; `NODE_TARGETS=(operator poly resy)`; `tag_suffix_for_target()` case arm per target | The de-facto registry today (per ci-cd.md axiom 16). Catalog files exist but don't drive it. |
| `scripts/ci/detect-affected.sh`                                                | per-target case arms mapping `nodes/<name>/*` → `add_target <name>`                                                                     | New node = new case arm. Catalog has no `path_prefix` field yet.                             |
| `scripts/ci/wait-for-argocd.sh`                                                | `APPS=(operator poly resy scheduler-worker …)` default                                                                                  | The decide-job pattern eliminates the need for any default; callers pass APPS explicitly.    |
| `infra/compose/runtime/docker-compose.yml`                                     | service definitions per node + `COGNI_NODE_ENDPOINTS=operator=http://app:3000,poly=http://poly:3100,…`                                  | Not generated; hand-edited.                                                                  |
| `infra/k8s/argocd/<env>-applicationset.yaml`                                   | implicit via `files: infra/catalog/*.yaml`                                                                                              | ✅ already catalog-driven.                                                                   |
| Future `scripts/ops/bootstrap-per-node-deploy-branches.sh` (task.0372 Layer 1) | would have to re-enumerate the node list                                                                                                | **Avoidable** by landing this task first.                                                    |

## Catalog shape — what needs adding

Existing fields per `infra/catalog/<name>.yaml` (already declared by task.0247 + task.0320):

```yaml
name: operator
type: node # node | service
port: 3000
node_id: "<uuid>"
dockerfile: nodes/operator/app/Dockerfile
image_tag_suffix: "" # "" for operator, "-poly", "-resy", "-scheduler-worker"
migrator_tag_suffix: "-operator-migrate"
candidate_a_branch: deploy/candidate-a-operator
preview_branch: deploy/preview-operator
production_branch: deploy/production-operator
```

New field this task adds:

```yaml
path_prefix: nodes/operator/ # detect-affected.sh maps this prefix → this target
# (scheduler-worker uses services/scheduler-worker/)
```

Optionally (deferred to follow-up if non-trivial):

```yaml
compose_service: operator # name in docker-compose.runtime.yml
compose_endpoint_url: "http://app:3000" # for COGNI_NODE_ENDPOINTS generation
```

The compose fields are Run-tier ("regenerate compose from catalog"). This task ships the Walk tier (read-only consumers), not full compose generation.

## Design (revision 3 — locked in 2026-04-25)

> **Revision history**
>
> - v1 — bash readers + bespoke `check-catalog-ssot.sh` repo-grep lint. Rejected /review-design v1: _"Custom linters exist because the architecture leaks. Fix the architecture so the leak can't happen."_
> - v2 — yq + check-jsonschema + decide-job pattern. Cited `mikefarah/yq@v4` as install action; cited `python-jsonschema/check-jsonschema` as first-party GHA action. /review-design v2 flagged both action names as unverified.
> - v3 (this) — researched and verified. **`yq 4.52.5` is pre-installed on `ubuntu-24.04`** (every workflow in this repo runs on `ubuntu-latest` which aliases to 24.04). No install action needed — just call `yq` in `run:` blocks. **`check-jsonschema` has no first-party action** — install via `pipx install check-jsonschema` (latest 0.37.1) and invoke as a CLI. Verified yq query expressions with a local 4.53.2 yq against the live `infra/catalog/`.

### Outcome

**One declaration site: `infra/catalog/<name>.yaml`.** A single `decide` job per workflow reads it via `yq` and emits `targets_json` matrix output; every downstream job consumes that one source. Hardcoded node lists become _impossible to introduce_ — there is no place for a new `(operator poly resy scheduler-worker)` literal to live. JSON Schema validates catalog files on every PR. Adding a node = drop a catalog yaml + write a Dockerfile + add an overlay; CI fans out automatically.

### Architectural primitive — the `decide` job pattern

Every workflow that needs a per-node fan-out gains one job at the head. yq is pre-installed on `ubuntu-latest` (verified: `ubuntu-24.04` ships yq 4.52.5), so the job has no install step:

```yaml
jobs:
  decide:
    runs-on: ubuntu-latest
    outputs:
      targets_json: ${{ steps.read.outputs.targets_json }}
      apps_csv: ${{ steps.read.outputs.apps_csv }}
    steps:
      - uses: actions/checkout@v4
      - id: read
        run: |
          # Verified expressions (yq v4.52+, see Validation block).
          targets_json=$(yq ea -o=json -I=0 '[.name]' infra/catalog/*.yaml)
          apps_csv=$(yq ea '.name' infra/catalog/*.yaml | paste -sd,)
          echo "targets_json=$targets_json" >> "$GITHUB_OUTPUT"
          echo "apps_csv=$apps_csv"          >> "$GITHUB_OUTPUT"
```

Downstream consumers reference `${{ needs.decide.outputs.targets_json }}` for the matrix and `apps_csv` for `wait-for-argocd.sh`'s `PROMOTED_APPS`. **No bash array of node names lives anywhere in CI** other than `infra/catalog/*.yaml`. Structural prevention, not policy enforcement.

> **Scope honesty:** This PR adds the decide job to `candidate-flight.yml` only — the worked example task.0372 will reuse for the other two fan-out workflows. `flight-preview.yml` and `promote-and-deploy.yml` continue to derive `promoted_apps` from `promote-build-payload.sh`, which itself is catalog-driven via `image-tags.sh` after Commit 3 below. Both provenance chains terminate at catalog; the decide-job pattern is the cleaner long-term shape that task.0372 fully adopts.

### Approach

**Five small commits, in order.** Each independently revertable.

#### Commit 1 — Spec rewrite: `docs/spec/ci-cd.md` axiom 16

Replace the existing axiom (`scripts/ci/lib/image-tags.sh` is the registry) with:

> **CATALOG_IS_SSOT.** `infra/catalog/*.yaml` is the single declaration site for nodes and node-shaped services for **CI fan-out and digest promotion**. Workflows that fan out per node SHOULD adopt a `decide` job at the head that reads catalog via the pre-installed `yq` (no install step needed on `ubuntu-latest`); downstream jobs consume that decide-job output. Bash scripts that need a per-node enumeration source `scripts/ci/lib/image-tags.sh`, which itself reads catalog. Schema is validated on every PR that touches `infra/catalog/**` via the `check-jsonschema` CLI. Adding a node = drop a catalog yaml + Dockerfile + overlay; nothing else needs editing. Compose generation from catalog (`infra/compose/runtime/docker-compose.yml`) and k8s overlay generation are tracked as separate follow-ups; this axiom does **not** cover them yet.

Spec rewrite **first** so each subsequent commit is reviewable against the new contract.

#### Commit 2 — Add `path_prefix:` field + JSON Schema

Add `path_prefix:` to all 4 catalog files (the field `detect-affected.sh` will consume in Commit 4):

```yaml
# infra/catalog/operator.yaml
path_prefix: nodes/operator/
# infra/catalog/scheduler-worker.yaml
path_prefix: services/scheduler-worker/
```

Create `infra/catalog/_schema.json` (JSON Schema draft-2020-12) declaring required fields (`name`, `type`, `port`, `node_id`, `dockerfile`, `image_tag_suffix`, `path_prefix`, `candidate_a_branch`, `preview_branch`, `production_branch`) with type and pattern constraints (e.g., `path_prefix` is a string ending with `/`; `node_id` matches a UUID regex; `*_branch` starts with `deploy/`). The leading `_` keeps the file outside the AppSet glob (`infra/catalog/*.yaml`) so Argo never tries to template it.

Wire validation into `pr-build.yml`:

```yaml
- name: Validate infra/catalog schema
  if: ${{ github.event_name == 'pull_request' }}
  run: |
    pipx install 'check-jsonschema==0.37.1'
    check-jsonschema --schemafile infra/catalog/_schema.json infra/catalog/*.yaml
```

`pipx` is pre-installed on `ubuntu-latest`. `check-jsonschema` has no first-party GHA action; the pip CLI is the canonical pattern.

#### Commit 3 — Migrate `scripts/ci/lib/image-tags.sh` to catalog-backed readers

Replace hardcoded arrays + case-arm function with verified `yq` expressions. Populate compatibility shims (`ALL_TARGETS`, `NODE_TARGETS`) at source time so existing callers keep working unchanged:

```bash
catalog_targets()       { yq ea '.name' infra/catalog/*.yaml ; }
catalog_node_targets()  { yq ea '.name' infra/catalog/*.yaml -- \
                          --from-file <(printf '%s\n' 'select(.type == "node")') ; }
# Or equivalently and more readable:
# catalog_node_targets() { yq ea '. | select(.type == "node") | .name' infra/catalog/*.yaml ; }
catalog_field()         { yq ".${2}" "infra/catalog/${1}.yaml" ; }
tag_suffix_for_target() { catalog_field "$1" image_tag_suffix ; }

mapfile -t ALL_TARGETS  < <(catalog_targets)
mapfile -t NODE_TARGETS < <(catalog_node_targets)
```

Verified locally with yq 4.53.2 (matches `ubuntu-latest`'s 4.52.5 series):

- `yq ea '.name' infra/catalog/*.yaml` → `operator\npoly\nresy\nscheduler-worker`
- `yq ea '. | select(.type == "node") | .name' infra/catalog/*.yaml` → `operator\npoly\nresy`

Semantics-preserving: catalog has 3 `type: node` entries (operator/poly/resy) + 1 `type: service` (scheduler-worker). Resulting shim arrays match the current literals exactly.

#### Commit 4 — Migrate `scripts/ci/detect-affected.sh`

Replace the per-target case arms with iteration over catalog `path_prefix`:

```bash
while IFS= read -r catalog_file; do
  target=$(yq '.name' "$catalog_file")
  prefix=$(yq '.path_prefix' "$catalog_file")
  case "$path" in "${prefix}"*) add_target "$target" ;; esac
done < <(printf '%s\n' infra/catalog/*.yaml)
```

#### Commit 5 — `wait-for-argocd.sh` default-APPS removal + decide-job worked example

**Caller audit confirmed both existing callers already pass `PROMOTED_APPS`:**

- `candidate-flight.yml:387` → `PROMOTED_APPS: ${{ needs.flight.outputs.promoted_apps }}`
- `promote-and-deploy.yml:688` → `PROMOTED_APPS: ${{ needs.promote-k8s.outputs.promoted_apps }}`

The hardcoded default `APPS=(operator poly resy scheduler-worker sandbox-openclaw)` is dead code. Two edits:

1. **Delete the default.** Empty `PROMOTED_APPS` → exit 1 with a message pointing to the decide-job pattern. Prevents silent drift forever.
2. **Wire the decide job in `candidate-flight.yml` as the worked example.** Add `decide` upstream of `flight`. The `flight` job's `wait-for-argocd` step continues to read `flight.outputs.promoted_apps` (unchanged). The new decide job's value in this PR is to prove the pattern compiles end-to-end and to give task.0372 a concrete shape to reuse for `flight-preview.yml` + `promote-and-deploy.yml`.

#### Out of scope (filed as follow-ups)

- **Compose generation from catalog** — `infra/compose/runtime/docker-compose.yml` per-service blocks + `COGNI_NODE_ENDPOINTS` env. Standard primitive for the follow-up: Kustomize `replacements` / `components`, or a small render script consuming catalog. Spec axiom 16 explicitly excludes this for now.
- **K8s overlay generation from catalog** — same shape, same follow-up.
- **Decide-job adoption in `flight-preview.yml` + `promote-and-deploy.yml`** — task.0372.
- **Removing the compatibility shims** in `image-tags.sh` (`ALL_TARGETS` / `NODE_TARGETS`). After one release cycle. Tracked in the same follow-up.

### Reuses (OSS-native, all verified)

- **`yq` (mikefarah v4)** — pre-installed on `ubuntu-latest` (resolves to `ubuntu-24.04` as of April 2026; ships yq 4.52.5). No install step. Direct invocation in `run:` blocks. Verified locally with 4.53.2 against `infra/catalog/`. Source: [actions/runner-images Ubuntu2404 readme](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md).
- **`check-jsonschema`** — pip-distributed CLI (latest stable 0.37.1, March 2026). No first-party GHA action. Invoked via `pipx install check-jsonschema && check-jsonschema --schemafile …` in one step on PRs that touch `infra/catalog/**`. Source: [python-jsonschema/check-jsonschema](https://github.com/python-jsonschema/check-jsonschema).
- **GHA `decide` → `matrix` pattern** — already used in `pr-build.yml` (task.0321: detect → build matrix → manifest). This task generalizes the pattern; task.0372 adopts it across the other fan-out workflows.
- **ApplicationSet `files:` generator** — already catalog-driven. No change.

### Rejected

- **v1: bash readers + bespoke `check-catalog-ssot.sh` lint.** A lint exists when the architecture can't structurally prevent the regression. The decide-job pattern + JSON Schema validation _do_ prevent it. No bespoke lint needed.
- **`python3` reader instead of `yq`.** yq is the GitOps-standard reader and is pre-installed. python3 inline parsers are an anti-pattern when the standard tool is one shell call away.
- **`mikefarah/yq@v4` as an install action (v2 plan).** That action runs yq inside its container, not on the host's PATH for downstream `run:` steps. Wrong shape. yq pre-install on the runner makes the question moot.
- **First-party `python-jsonschema/check-jsonschema-action` (v2 plan).** No such first-party action exists. Pip CLI is the canonical pattern.
- **Top-down rewrite — generate compose + overlays in this task.** Too big; multiplies blast radius. Standard pattern (Kustomize replacements / components) deferred to a follow-up. Spec axiom 16 explicitly excludes compose for now.
- **Land this AFTER task.0372.** Would force task.0372 to either ship with hardcoded lists or land a partial SSoT inside the matrix PR.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CATALOG_IS_SSOT: `infra/catalog/*.yaml` is the only file that declares nodes. (spec: ci-cd, axiom 16 rewrite)
- [ ] DECIDE_JOB_PATTERN_AVAILABLE: `candidate-flight.yml` has a `decide` job at the head reading catalog via pre-installed `yq` and emitting `targets_json` + `apps_csv`. The pattern compiles end-to-end and is ready for `flight-preview.yml` and `promote-and-deploy.yml` to adopt in task.0372. (spec: ci-cd)
- [ ] CATALOG_BACKED_PROMOTED_APPS: The `promoted_apps` flowing from `promote-build-payload.sh` into `wait-for-argocd.sh` derives from catalog (via `image-tags.sh` after Commit 3). Both decide-job and promoted-apps provenance chains terminate at `infra/catalog/*.yaml` — no other source of node names exists. (spec: ci-cd)
- [ ] SCHEMA_VALIDATED_ON_PR: `python-jsonschema/check-jsonschema` validates `infra/catalog/*.yaml` against `infra/catalog/_schema.json` on every PR that touches catalog. Schema declares required fields including `path_prefix`. (spec: ci-cd)
- [ ] NO_DEFAULT_APPS_LIST: `scripts/ci/wait-for-argocd.sh` has no hardcoded default APPS. Callers pass `PROMOTED_APPS` explicitly (sourced from a decide job). Empty `PROMOTED_APPS` → loud failure with a pointer to the decide-job pattern. (spec: ci-cd)
- [ ] BACKWARDS_COMPATIBLE_SHIM: `image-tags.sh` continues to export `ALL_TARGETS` and `NODE_TARGETS` arrays (populated from catalog) so existing bash callers keep working unchanged. Shims tracked for removal in a follow-up after one release cycle. (spec: ci-cd)
- [ ] OSS_TOOLS_NOT_BESPOKE: yq (pre-installed on `ubuntu-latest`) for reading; `check-jsonschema` (pip CLI) for validation; GHA `decide` → `matrix` for fan-out. No bespoke linter, no bespoke parser, no in-repo `check-catalog-ssot.sh`, no install action for yq. (spec: architecture)
- [ ] AXIOM_CARVES_OUT_COMPOSE: ci-cd.md axiom 16 rewrite explicitly says CATALOG_IS_SSOT covers CI fan-out + digest promotion, NOT compose / k8s overlay generation. Compose remains hand-edited until a separate follow-up. (spec: ci-cd)
- [ ] TASK_0372_MULTIPLIER: After this task, task.0372's bootstrap script and matrix `include` derive from catalog without further code. Verified by drafting `for c in infra/catalog/*.yaml; do for env in candidate-a preview; do …; done` as a checkpoint snippet in the task.0372 design.
- [ ] NO_NEW_RUNTIME_DEPS: No new packages, no new long-running services, no new GHA actions. yq is pre-installed; check-jsonschema is `pipx install` (one line). (spec: architecture)
- [ ] SIMPLE_SOLUTION: Net new code is `_schema.json` + `path_prefix:` × 4 + ~30 lines of bash refactor + 1 decide job + 1 `pipx install` step. **Zero bespoke linter, zero bespoke parser, zero new GHA actions.**
- [ ] ARCHITECTURE_ALIGNMENT: `infra/catalog/*.yaml` was always meant to be the catalog (per `infra/AGENTS.md`); this task delivers on the promise via OSS-native tooling.

### Files

**Create**

- `infra/catalog/_schema.json` — JSON Schema for catalog files. Declares required fields + types + patterns (e.g., `path_prefix` ends with `/`).

**Modify (catalog — add field, validate)**

- `infra/catalog/{operator,poly,resy,scheduler-worker}.yaml` — add `path_prefix:` field. ~4 lines total.

**Modify (consumers — replace hardcodes with catalog reads)**

- `scripts/ci/lib/image-tags.sh` — replace hardcoded arrays + `tag_suffix_for_target` case arm with catalog-backed `yq` readers. Populate `ALL_TARGETS` / `NODE_TARGETS` shim arrays at source time so existing callers keep working.
- `scripts/ci/detect-affected.sh` — replace per-target case arms with iteration over catalog `path_prefix`.
- `scripts/ci/wait-for-argocd.sh` — delete the hardcoded default `APPS=(…)`. Empty `PROMOTED_APPS` → fail loud with a pointer to the decide-job pattern.

**Modify (workflows — adopt decide-job pattern)**

- `.github/workflows/pr-build.yml` — add a `validate-catalog` step using `python-jsonschema/check-jsonschema` action (runs on PRs touching `infra/catalog/**`).
- `.github/workflows/candidate-flight.yml` — add `decide` job at the head; downstream `flight` job continues to pass `flight.outputs.promoted_apps` to `wait-for-argocd.sh` (decide is wired here as the worked example task.0372 will reuse).

**Modify (spec)**

- `docs/spec/ci-cd.md` — rewrite axiom 16 to `CATALOG_IS_SSOT` per the prose above. **First commit** of the PR for review parity.
- `infra/AGENTS.md` — name the `path_prefix:` field alongside the `*_branch` fields task.0320 added.

**Test**

- Manual: source `image-tags.sh`, confirm `ALL_TARGETS` expansion is byte-identical to pre-migration. Run `detect-affected.sh` against a known PR (e.g., #1012 feat/poly-…); confirm `targets` output is byte-identical.
- CI dry-run: open this PR. New `validate-catalog` step is green; existing CI green; no regressions.

## Validation

### exercise

1. **yq query smoke (pre-implementation, already done — see Approach):** `yq ea -o=json -I=0 '[.name]' infra/catalog/*.yaml` → `["operator","poly","resy","scheduler-worker"]`. `yq ea '. | select(.type == "node") | .name' infra/catalog/*.yaml` → `operator\npoly\nresy`. Verified locally with yq 4.53.2.
2. **Source-time shim parity:** `source scripts/ci/lib/image-tags.sh && printf '%s\n' "${ALL_TARGETS[@]}"` → byte-identical to pre-migration. `printf '%s\n' "${NODE_TARGETS[@]}"` → `operator poly resy`.
3. **Catalog-driven extension:** Drop a fixture `infra/catalog/test-canary.yaml` (with all schema-required fields); re-source `image-tags.sh`; `ALL_TARGETS` now includes `test-canary`. Delete fixture, re-source; back to 4 names. Done.
4. **Schema rejection:** Remove the `path_prefix:` field from a catalog file; run `check-jsonschema --schemafile infra/catalog/_schema.json infra/catalog/*.yaml` → exits non-zero with a clear missing-field message. Revert.
5. **CI dry-run:** Open this PR. The new schema-validation step is green. The new `decide` job in `candidate-flight.yml` emits the expected `targets_json` and `apps_csv` to its outputs (visible in workflow run summary). All existing CI green.

### observability

- `validate-catalog` step log: schema validation result on every PR touching `infra/catalog/**`.
- `decide` job outputs (`targets_json`, `apps_csv`) visible in workflow run summary.
- Image-tag and affected-targets workflow output for a known PR (e.g., `feat/poly-…`) is byte-identical pre- and post-migration. (Captured by re-running the relevant scripts locally on a checkout of an existing open PR.)

## Success criteria

- A new node ships in **3 file edits**: drop `infra/catalog/<name>.yaml`, write `nodes/<name>/app/Dockerfile`, add `infra/k8s/overlays/<env>/<name>/kustomization.yaml`. Every other CI / infra concern picks it up automatically — no per-node literal needs editing in any workflow or script.
- task.0372's Layer 1 bootstrap script and matrix `include` both derive from catalog without further code.
- Compose generation remains a follow-up (Kustomize replacements / components — standard primitive); the CI fan-out contract is locked structurally by the decide-job pattern, not by a custom lint.

## PR / Links

- Reviewer note: 2026-04-25 task.0372 PR-prep review.
- Blocks: [task.0372](task.0372.candidate-flight-matrix-cutover.md) (frozen pending this).
- Spec: [docs/spec/ci-cd.md](../../docs/spec/ci-cd.md) axiom 16 (will be rewritten).
