---
id: task.0374
type: task
title: "Catalog-as-SSoT — make infra/catalog/*.yaml the single node declaration"
status: needs_design
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

## Design (revision 2 — structural prevention, OSS tools)

> **Revision history**
> v1 — bash readers + bespoke repo-grep lint (`check-catalog-ssot.sh`). Rejected by /review-design 2026-04-25: _"Why are we writing linters + parsers? Custom linters exist because the architecture leaks. The OSS answer is to fix the architecture so the leak can't happen."_
> v2 (this) — yq (standard reader), JSON Schema validation (standard contract), decide-job pattern (structural prevention via a single matrix-emitting job). No bespoke lint, no bespoke parser.

### Outcome

**One declaration site: `infra/catalog/<name>.yaml`.** A single `decide` job per workflow reads it via `yq` and emits `targets_json` matrix output; every downstream job consumes that one source. Hardcoded node lists become _impossible to introduce_ — there is no place for a new `(operator poly resy scheduler-worker)` literal to live. JSON Schema validates catalog files on every PR. Adding a node = drop a catalog yaml + write a Dockerfile + add an overlay; CI fans out automatically.

### Architectural primitive — the `decide` job pattern

Every workflow that needs a per-node fan-out gains one job at the head:

```yaml
jobs:
  decide:
    runs-on: ubuntu-latest
    outputs:
      targets_json: ${{ steps.read.outputs.targets_json }}
      apps_csv: ${{ steps.read.outputs.apps_csv }}
    steps:
      - uses: actions/checkout@v4
      - uses: mikefarah/yq@v4 # the standard yq install action
      - id: read
        run: |
          targets_json=$(yq -o=json -I=0 '[.. | select(.name) | .name]' infra/catalog/*.yaml)
          apps_csv=$(yq -o=tsv '.name' infra/catalog/*.yaml | tr '\n' ',' | sed 's/,$//')
          echo "targets_json=$targets_json" >> "$GITHUB_OUTPUT"
          echo "apps_csv=$apps_csv" >> "$GITHUB_OUTPUT"
```

Downstream consumers reference `${{ needs.decide.outputs.targets_json }}` (matrix) or pass `apps_csv` to `wait-for-argocd.sh` as `PROMOTED_APPS`. **There is no bash array of node names anywhere in CI.** The only place a node literal can live is `infra/catalog/*.yaml`.

This is structural prevention, not policy enforcement: no lint required.

### Approach

**Five small commits, in order.** Each independently revertable.

#### Commit 1 — Add `path_prefix:` field + JSON Schema

Add `path_prefix:` to all 4 catalog files (the field `detect-affected.sh` will consume in Commit 4):

```yaml
# infra/catalog/operator.yaml
path_prefix: nodes/operator/
# infra/catalog/scheduler-worker.yaml
path_prefix: services/scheduler-worker/
```

Create `infra/catalog/_schema.json` (JSON Schema) declaring required fields (`name`, `type`, `port`, `node_id`, `dockerfile`, `image_tag_suffix`, `path_prefix`, `candidate_a_branch`, `preview_branch`, `production_branch`) with type and pattern constraints. Wire `python-jsonschema/check-jsonschema` action into `pr-build.yml` (single step, runs on PRs that touch `infra/catalog/**`). Standard tool, no bespoke code.

#### Commit 2 — Spec rewrite: `docs/spec/ci-cd.md` axiom 16

Replace the existing axiom (`scripts/ci/lib/image-tags.sh` is the registry) with:

> **CATALOG_IS_SSOT.** `infra/catalog/*.yaml` is the single declaration site for nodes and node-shaped services. CI workflows that fan out per node MUST consume the matrix via a `decide` job that reads catalog via `yq`; downstream jobs MUST consume that decide-job output, not their own enumeration. Schema is validated on every PR via `check-jsonschema`. Adding a node = drop a catalog yaml + Dockerfile + overlay; nothing else needs editing.

Spec rewrite **first** so each subsequent commit is reviewable against the new contract.

#### Commit 3 — Migrate `scripts/ci/lib/image-tags.sh` to catalog-backed readers

Replace hardcoded arrays + case-arm function with `yq` readers, populating compatibility shims (`ALL_TARGETS`, `NODE_TARGETS`) at source time so existing callers keep working unchanged:

```bash
catalog_targets()       { yq -r '.name' infra/catalog/*.yaml ; }
catalog_node_targets()  { yq -r 'select(.type == "node") | .name' infra/catalog/*.yaml ; }
catalog_field()         { yq -r ".${2}" "infra/catalog/${1}.yaml" ; }
tag_suffix_for_target() { catalog_field "$1" image_tag_suffix ; }

mapfile -t ALL_TARGETS  < <(catalog_targets)
mapfile -t NODE_TARGETS < <(catalog_node_targets)
```

Verified semantics-preserving: catalog `type: node` entries are operator/poly/resy; `scheduler-worker` is `type: service`. Resulting `NODE_TARGETS=(operator poly resy)` matches the current literal.

#### Commit 4 — Migrate `scripts/ci/detect-affected.sh`

Replace the per-target case arms with iteration over catalog `path_prefix`:

```bash
while IFS= read -r catalog_file; do
  target=$(yq -r '.name' "$catalog_file")
  prefix=$(yq -r '.path_prefix' "$catalog_file")
  case "$path" in "${prefix}"*) add_target "$target" ;; esac
done < <(printf '%s\n' infra/catalog/*.yaml)
```

#### Commit 5 — Decide-job adoption: `wait-for-argocd.sh` callers + matrix readiness

Two surface edits — neither one a parser, both structural:

1. **`wait-for-argocd.sh` default APPS list deleted entirely.** Callers must pass `PROMOTED_APPS` explicitly. The only existing default-using caller would have a behavior change (silently waited on a hardcoded list); make it loud: if `PROMOTED_APPS` is empty, the script exits 1 with a clear message pointing to the decide-job pattern. Saves us from "default APPS drifted" forever.
2. **One worked example wired in `candidate-flight.yml`** — add the `decide` job upstream of the existing `flight` job, pass `decide.outputs.apps_csv` (when matching the affected promoted set) explicitly. Other workflows already pass `PROMOTED_APPS` from `flight.outputs.promoted_apps`, so the contract is preserved without changes there. This commit also proves the decide-job-as-only-source pattern works end-to-end for task.0372 to reuse.

#### Out of scope (filed as follow-ups)

- **Compose generation from catalog** — `infra/compose/runtime/docker-compose.yml` per-service blocks + `COGNI_NODE_ENDPOINTS` env. Solved later via Kustomize `replacements` / `components` (the standard primitive for "render N copies of a template from a catalog"). Filed separately.
- **K8s overlay generation from catalog** — same pattern, same follow-up.
- **Removing the compatibility shims** in `image-tags.sh` (`ALL_TARGETS` / `NODE_TARGETS` arrays). After one release cycle when no caller relies on them as bash arrays. Tracked in the same follow-up.

### Reuses (OSS-native)

- **`mikefarah/yq@v4`** — the standard YAML reader for GitOps tooling. Installed via the maintained `mikefarah/yq@v4` GHA action (one line per workflow). Not preinstalled on `ubuntu-latest`, so the install step is explicit; this is the standard pattern.
- **`python-jsonschema/check-jsonschema`** — the standard JSON-Schema validator GHA action. Wired into `pr-build.yml` to validate `infra/catalog/*.yaml` against `infra/catalog/_schema.json`. No custom validator code.
- **GHA `decide` → `matrix` pattern** — already used in `pr-build.yml` (task.0321: detect → build matrix → manifest). This task generalizes the pattern: every per-node fan-out workflow gets one decide job feeding all matrix consumers.
- **ApplicationSet `files:` generator** — already catalog-driven. No change.

### Rejected

- **v1: bash readers + bespoke `check-catalog-ssot.sh` lint.** Rejected: a lint exists when the architecture can't structurally prevent the regression. The decide-job pattern + JSON Schema validation _do_ prevent it (no place to put a hardcoded literal that any production code path consumes; schema rejects malformed catalog entries at PR time). No bespoke lint needed. (Reviewer note 2026-04-25.)
- **`python3` reader instead of `yq`.** Reviewer was explicit: yq is the GitOps-standard reader. Adding it via `mikefarah/yq@v4` is one line per workflow and gives us the same selector syntax everywhere (workflows, scripts, ad-hoc debugging). python3 inline parsers are an anti-pattern compared to the standard tool.
- **Top-down rewrite — generate compose + overlays in this task.** Too big; multiplies blast radius. Standard pattern (Kustomize replacements / components) deferred to a separate follow-up.
- **Land this AFTER task.0372.** Would force task.0372 to either ship with hardcoded lists (re-paying the migration cost on the next node) or land a partial SSoT inside the matrix PR. Reviewer's pivot is correct.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CATALOG_IS_SSOT: `infra/catalog/*.yaml` is the only file that declares nodes. (spec: ci-cd, axiom 16 rewrite)
- [ ] DECIDE_JOB_IS_ONLY_SOURCE: Every workflow that fans out per node has exactly one `decide` job (head of the workflow) reading catalog via `yq`. Downstream jobs consume `needs.decide.outputs.*` — never their own enumeration. (spec: ci-cd)
- [ ] SCHEMA_VALIDATED_ON_PR: `python-jsonschema/check-jsonschema` validates `infra/catalog/*.yaml` against `infra/catalog/_schema.json` on every PR that touches catalog. Schema declares required fields including `path_prefix`. (spec: ci-cd)
- [ ] NO_DEFAULT_APPS_LIST: `scripts/ci/wait-for-argocd.sh` has no hardcoded default APPS. Callers pass `PROMOTED_APPS` explicitly (sourced from a decide job). Empty `PROMOTED_APPS` → loud failure with a pointer to the decide-job pattern. (spec: ci-cd)
- [ ] BACKWARDS_COMPATIBLE_SHIM: `image-tags.sh` continues to export `ALL_TARGETS` and `NODE_TARGETS` arrays (populated from catalog) so existing bash callers keep working unchanged. Shims tracked for removal in a follow-up after one release cycle. (spec: ci-cd)
- [ ] OSS_TOOLS_NOT_BESPOKE: yq for reading; check-jsonschema for validation; GHA decide→matrix for fan-out. No bespoke linter, no bespoke parser, no in-repo `check-catalog-ssot.sh`. (spec: architecture)
- [ ] TASK_0372_MULTIPLIER: After this task, task.0372's bootstrap script and matrix `include` derive from catalog without further code. Verified by drafting `for c in infra/catalog/*.yaml; do for env in candidate-a preview; do …; done` as a checkpoint snippet in the task.0372 design.
- [ ] NO_NEW_RUNTIME_DEPS: No new packages, no new long-running services. New CI tooling is two well-maintained GHA actions (yq, check-jsonschema). (spec: architecture)
- [ ] SIMPLE_SOLUTION: Net new code is `_schema.json` + `path_prefix:` × 4 + ~30 lines of bash refactor + 1 decide job + 2 GHA-action install lines. **Zero bespoke linter, zero bespoke parser.**
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

1. Local: source `image-tags.sh`; `printf '%s\n' "${ALL_TARGETS[@]}"` → `operator poly resy scheduler-worker` (byte-identical to pre-migration). Drop a fixture catalog `infra/catalog/_test-canary.yaml` with `name: canary`; re-source; output now includes `canary`. Delete fixture.
2. Local: drop a malformed catalog entry (e.g., remove the required `path_prefix` field). Run `check-jsonschema --schemafile infra/catalog/_schema.json infra/catalog/*.yaml` → fails with a clear schema-violation message. Revert.
3. CI: open this PR. New `validate-catalog` step (check-jsonschema) green. New `decide` job in `candidate-flight.yml` emits the expected `targets_json` and `apps_csv`. All existing CI green (no regression).

### observability

- `validate-catalog` step log on every PR confirms catalog files conform to schema.
- `decide` job outputs (`targets_json`, `apps_csv`) visible in workflow run summary; downstream consumers reference them via `${{ needs.decide.outputs.* }}`.
- Image-tag and affected-targets workflow output for a known PR (e.g., `feat/poly-…`) is byte-identical pre- and post-migration.

## Success criteria

- A new node ships in **3 file edits**: drop `infra/catalog/<name>.yaml`, write `nodes/<name>/app/Dockerfile`, add `infra/k8s/overlays/<env>/<name>/kustomization.yaml`. Every other CI / infra concern picks it up automatically — no per-node literal needs editing in any workflow or script.
- task.0372's Layer 1 bootstrap script and matrix `include` both derive from catalog without further code.
- Compose generation remains a follow-up (Kustomize replacements / components — standard primitive); the CI fan-out contract is locked structurally by the decide-job pattern, not by a custom lint.

## PR / Links

- Reviewer note: 2026-04-25 task.0372 PR-prep review.
- Blocks: [task.0372](task.0372.candidate-flight-matrix-cutover.md) (frozen pending this).
- Spec: [docs/spec/ci-cd.md](../../docs/spec/ci-cd.md) axiom 16 (will be rewritten).
