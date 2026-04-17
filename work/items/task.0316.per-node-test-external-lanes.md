---
id: task.0316
type: task
title: "Wire per-node test:external lanes + move Ollama specs"
status: needs_review
priority: 3
rank: 99
estimate: 2
branch: task/0316-per-node-test-external
summary: "All four node apps already had `vitest.external.config.mts` + populated `tests/external/` trees, but no node's `package.json` exposed a `test:external` script and root `pnpm test:external` was hardcoded to operator's config. Wire per-node scripts, add a turbo task, fan out root, and move the Ollama adapter specs out of the default unit lane."
outcome: |
  - `test:external` / `test:external:money` scripts live in every node's package.json.
  - `turbo.json` defines both external tasks with appropriate env passthrough.
  - Root `pnpm test:external` fans out via turbo; per-node root shortcuts (`test:external:{operator,poly,resy,node-template}`) let a developer target one node.
  - Ollama adapter specs moved from `nodes/*/app/tests/unit/.../openai-compatible-llm.adapter.spec.ts` to `nodes/*/app/tests/external/ai/openai-compatible-llm.adapter.external.test.ts` in all 4 nodes. `OLLAMA_URL` now reads from env.
  - Default unit lane no longer does HTTP probes at module load.
spec_refs: []
assignees: []
project: proj.system-test-architecture
created: 2026-04-16
updated: 2026-04-16
labels: [testing, infrastructure]
---

# task.0316 — Wire per-node test:external lanes

## Problem

The prior scaffold was half-finished. Every node app had:

- `vitest.external.config.mts` (identical copies)
- Populated `tests/external/` tree (ingestion / review / money / operator-wallet — all inherited from the template)

But nothing in each node's `package.json` exposed a `test:external` script, and root `pnpm test:external` was hardcoded to operator's config — so poly/resy/node-template external tests were unreachable.

Meanwhile the Ollama adapter specs sat in `tests/unit/` in all 4 nodes, guarded by a module-load probe (`fix/ollama-probe-gate`). That probe stops the default lane from reddening, but the specs are integration tests — they belong in the external lane.

## Outcome

- Each node's `package.json` has `test:external` and `test:external:money` scripts pointing at its local config.
- `turbo.json` defines `test:external` and `test:external:money` tasks with the env keys those runs need (GH app creds, OpenRouter keys, `OLLAMA_URL`, etc.).
- Root `package.json`:
  - `pnpm test:external` → `turbo run test:external` (fans out to all nodes).
  - `pnpm test:external:operator` / `:poly` / `:resy` / `:node-template` → per-node shortcuts.
- Ollama adapter specs moved to `nodes/*/app/tests/external/ai/openai-compatible-llm.adapter.external.test.ts`. `OLLAMA_URL` reads from env. `probeOllama()` kept — it's the right gate for an opt-in lane.

## Non-goals

- Not adding external coverage to CI (per tests/external/AGENTS.md: "NOT in default CI pipeline").
- Not deduplicating the 4 identical external configs / inherited test trees — sovereign-fork pattern, deliberate.
- Not touching inherited ingestion / review / money tests.

## Validation

- `pnpm check` green (workspace:test ran against all 4 nodes; Ollama specs no longer picked up by the unit lane).
- `pnpm -F @cogni/poly-app test:external` resolves the `vitest.external.config.mts` config and runs poly's external lane (skips unless Ollama up + GH creds present).
- `pnpm test:external` from root fans out across the 4 nodes via turbo.
- `rg "openai-compatible-llm.adapter.spec" nodes/` returns nothing; `rg "openai-compatible-llm.adapter.external.test" nodes/` returns 4 files.

## Notes

- **globalSetup fix**: `tests/component/setup/testcontainers-postgres.global.ts` called `pnpm db:migrate:direct` — that script only exists at workspace root, so when invoked via `pnpm -F <node>` (as turbo fan-out does), the `execSync` failed with `Command "db:migrate:direct" not found`. Changed to `pnpm -w db:migrate:direct` in all 4 node copies. Also used by component + stack lanes; workspace-root resolution is strictly safer.
- **Pre-existing breakage surfaced**: the inherited `tests/external/ingestion/**` and `tests/external/operator-wallet/**` copies in poly/resy/node-template have broken relative imports — `../../../../../services/scheduler-worker/...` is one level too shallow vs. the real depth. These tests fail to even collect. Not caused by this PR, but newly reachable. File a separate follow-up to either fix the paths or delete the inherited copies.
- Running root `pnpm test:external` will now spin up 4 testcontainer postgres instances (one per node's globalSetup). First-time cost is steep; subsequent cost depends on Docker cache. Per-node shortcuts avoid this.
- Consider a future task to deduplicate the 4 external-config copies into a shared helper — the duplication is template-inherited, not inherent.
