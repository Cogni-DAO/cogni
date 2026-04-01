---
id: task.0156.handoff
type: handoff
work_item_id: task.0156
status: active
created: 2026-03-10
updated: 2026-03-10
branch: design/agentic-project-management
last_commit: d6387ef3
---

# Handoff: @cogni/work-items — Port + Markdown Adapter

## Context

- We built `@cogni/work-items`, a typed port for reading/writing work items instead of hand-editing YAML frontmatter
- Two entry points: `@cogni/work-items` (pure types, platform-neutral) and `@cogni/work-items/markdown` (filesystem adapter)
- The adapter reads/writes `work/items/*.md` and `work/projects/*.md` with optimistic concurrency (SHA-256 revision) and status transition enforcement
- 16 contract tests pass. `pnpm check` clean. PR #542 open against staging
- **Nothing uses it yet** — the package is built but not wired into any consumer

## Current State

- **Done**: Port interfaces, domain types, transition table, MarkdownWorkItemAdapter, contract test suite, spec (`docs/spec/work-items-port.md`)
- **PR open**: https://github.com/Cogni-DAO/node-template/pull/542 — needs merge to staging
- **Worktree**: `.claude/worktrees/agentic-pm` (branch `design/agentic-project-management`)
- **Not done**: No consumer wired. The web app `/work` page still uses the bespoke `apps/operator/src/lib/work-scanner.ts` scanner. Skills (`/triage`, `/implement`, etc.) still hand-edit frontmatter
- **task.0152** exists at `needs_design` for skill migration, blocked on task.0156

## Decisions Made

- [Spec: work-items-port](../../docs/spec/work-items-port.md) — full port contract, invariants, adapter requirements
- [Project: proj.agentic-project-management](../../work/projects/proj.agentic-project-management.md) — roadmap (Crawl/Walk/Run/Sprint phases)
- Root entry stays pure types (no I/O). Adapter is a separate subpath export (`@cogni/work-items/markdown`)
- Optimistic concurrency via SHA-256 of raw YAML, not file mtime or git hash
- `SubjectRef` (not `ActorId`) for assignment — decoupled from actor table until story.0117 lands
- Relations stored per-file in frontmatter as `relations: [{to: "task.0042", type: "blocks"}]`

## Next Actions

The first wiring target is the **web app work dashboard** — it already reads work items and would benefit from typed data.

- [ ] **Merge PR #542** to staging
- [ ] **Wire the `/work` page**: Replace `apps/operator/src/lib/work-scanner.ts` → `MarkdownWorkItemAdapter.list()`. The existing `WorkItem` interface in work-scanner.ts is a subset of `@cogni/work-items`'s `WorkItem` type. Swap the import, instantiate the adapter with `process.cwd()`, update `view.tsx` to use the richer type
- [ ] **Unblock task.0152**: Once merged, update `blocked_by` and design the skill migration — `/triage` and `/implement` are the proof-of-concept consumers
- [ ] **Wire skills**: Replace direct `readFile`/`writeFile` + YAML parsing in skill code with `adapter.get()`, `adapter.transitionStatus()`, `adapter.patch()` etc.
- [ ] **Consider a pnpm script**: A thin CLI wrapper (e.g., `pnpm work:get task.0151`, `pnpm work:transition task.0151 needs_merge`) would let agents use the port from shell commands without TypeScript imports

## Risks / Gotchas

- **ID allocation race**: Two concurrent `create()` calls can collide. v0 assumes single-caller (one agent at a time). Don't parallelize item creation
- **`findById` is O(n)**: Every `get()` scans all files. Fine for <200 items, will need indexing if the item count grows significantly
- **Revision is YAML-hash, not file-hash**: The SHA-256 is computed over the raw YAML between `---` delimiters, not the entire file. Changing only the markdown body does NOT change the revision
- **The `work-scanner.ts` WorkItem type differs** from `@cogni/work-items`'s WorkItem — the scanner has `rank`, `spec_refs` (snake_case), `project` (string) while the port has `specRefs` (camelCase), `projectId` (branded). The view.tsx will need field name updates
- **Worktree path**: This work was done in `.claude/worktrees/agentic-pm`, not the main checkout. The branch is `design/agentic-project-management`

## Pointers

| File / Resource                                                 | Why it matters                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/work-items/src/ports.ts`                              | Port interfaces — the contract consumers code against                           |
| `packages/work-items/src/types.ts`                              | All domain types (`WorkItem`, `SubjectRef`, `WorkQuery`)                        |
| `packages/work-items/src/adapters/markdown/adapter.ts`          | The adapter implementation — all 9 command + 3 query methods                    |
| `packages/work-items/tests/contract/work-item-port.contract.ts` | Contract test suite — reusable for future adapters                              |
| `docs/spec/work-items-port.md`                                  | Spec with invariants, diagrams, acceptance checks                               |
| `work/projects/proj.agentic-project-management.md`              | Project roadmap — Crawl (ports) → Walk (relations) → Run (agents) → Sprint (DB) |
| `apps/operator/src/lib/work-scanner.ts`                         | **First replacement target** — bespoke scanner the `/work` page uses today      |
| `apps/operator/src/app/(app)/work/page.tsx`                     | Work dashboard page — calls `getWorkItems()` from scanner                       |
| `work/items/task.0152.skill-port-migration.md`                  | Next task — wire `/triage` + `/implement` skills to use port                    |
| `packages/work-items/AGENTS.md`                                 | Package-level AGENTS.md with public surface and boundaries                      |
