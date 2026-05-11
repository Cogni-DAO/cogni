---
id: task.0032.handoff
type: handoff
work_item_id: task.0032
status: active
created: 2026-02-11
updated: 2026-02-12
branch: feat/openclaw-devtools-image
last_commit: f8e4ea4c
---

# Handoff — task.0032: Upgrade Cogni from Node 20 to Node 22 LTS

## Context

- Cogni pinned Node 20.x across ~20 surfaces since repo scaffolding (Nov 2025) — convention inertia, not a hard constraint
- Next.js 16.0.1 requires `>=20.9.0`; no dependency has an upper-bound excluding Node 22
- OpenClaw has a hard `process.exit(1)` runtime guard on node < 22 — aligning to node:22 eliminates the ABI mismatch workaround that task.0031 (devtools image) was designed around
- This work is **Done** and PRd to `staging` as [PR #379](https://github.com/Cogni-DAO/cogni/pull/379)

## Current State

- task.0032 is **Done**. All 20 surfaces upgraded to Node 22. `pnpm check` passes.
- PR #379 targets `staging` — pending CI and review
- task.0031 (devtools image) is **unblocked** — the image can now use `node:22-bookworm` directly, matching OpenClaw's ABI with no native module rebuild step
- task.0022 (git relay MVP) depends on task.0031 completing first

## Decisions Made

- Pinned Volta to `22.22.0` (latest Node 22 LTS as of 2026-02-11) — see [task.0032 spec](../items/task.0032.node-22-upgrade.md)
- `@types/node` resolved to `22.19.7` — no type errors surfaced
- The `Unsupported engine` pnpm warning is cosmetic (Volta global default vs project pin). Fix per-dev: `volta install node@22`

## Next Actions

- [ ] Merge [PR #379](https://github.com/Cogni-DAO/cogni/pull/379) after CI passes
- [ ] Each developer runs `volta install node@22` to update their global Volta default
- [ ] Pick up **task.0031** — [spec](../items/task.0031.openclaw-cogni-dev-image.md), [handoff](task.0031.handoff.md)
- [ ] After task.0031: pick up **task.0022** (git relay MVP) — [spec](../items/task.0022.git-relay-mvp.md)
- [ ] See [proj.openclaw-capabilities P1 roadmap](../projects/proj.openclaw-capabilities.md) for full delivery sequence

## Risks / Gotchas

- **Volta global default stale**: Existing devs still have `node@20` globally. Harmless warning until they run `volta install node@22`
- **Docker image cache cold**: First build after merge pulls new `node:22-*` base images
- **CI runners**: If CI pins Node via `setup-node` action (not Volta), those workflows need updating — check `.github/workflows/`

## Pointers

| File / Resource                                        | Why it matters                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| `work/items/task.0032.node-22-upgrade.md`              | Completed task spec — checklist and compatibility analysis      |
| `work/items/task.0031.openclaw-cogni-dev-image.md`     | Next task — devtools image, unblocked by this upgrade           |
| `work/projects/proj.openclaw-capabilities.md`          | Parent project — P1 roadmap with task.0031 → task.0022 sequence |
| `docs/spec/openclaw-sandbox-spec.md`                   | Governing spec — 25 invariants for sandbox containers           |
| [PR #379](https://github.com/Cogni-DAO/cogni/pull/379) | The PR for this work                                            |
