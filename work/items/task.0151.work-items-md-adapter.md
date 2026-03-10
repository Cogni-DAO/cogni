---
id: task.0151
type: task
title: "packages/work-items — MarkdownWorkItemAdapter + contract tests"
status: done
priority: 0
rank: 6
estimate: 3
summary: "Implement MarkdownWorkItemAdapter in packages/work-items/src/adapters/markdown/, co-located with the port interfaces. Includes YAML frontmatter parsing, atomic read-modify-write with optimistic concurrency (SHA-256 revision), centralized ID allocation, status transition enforcement, and an adapter-agnostic contract test suite."
outcome: "MarkdownWorkItemAdapter passes all contract tests. get/list/create/patch/transitionStatus work against real markdown files. Optimistic concurrency rejects stale writes. ID allocation prevents collisions. Validator updated to accept relations and external_refs frontmatter."
spec_refs: [identity-model-spec, development-lifecycle]
assignees: []
credit:
project: proj.agentic-project-management
branch: design/agentic-project-management
pr:
reviewer: claude
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-10
labels: [work-system, agents, infrastructure, adapters]
external_refs:
---

# packages/work-items — MarkdownWorkItemAdapter + contract tests

## Requirements

- `MarkdownWorkItemAdapter` implementing `WorkItemQueryPort` and `WorkItemCommandPort`
- Read path: parse YAML frontmatter from `work/items/*.md` and `work/projects/*.md`
- Write path: atomic read-modify-write preserving markdown body (round-trip safe)
- Revision: SHA-256 of frontmatter YAML, checked on every write
- ID allocation: atomic counter using existing `next-work-id.mjs` logic
- Status transitions validated against the transition table from `@cogni/work-items`
- Relations stored in frontmatter as `relations: [{to: "task.0042", type: "blocks"}]`
- External refs stored in frontmatter as `external_refs: [{system: "github", kind: "pull_request", url: "..."}]`
- Unknown frontmatter keys preserved on write (round-trip safety)
- Contract test suite that validates port invariants (reusable for future adapters)
- Cursor pagination: markdown adapter ignores cursor, returns all matching results

## Design

### Outcome

Agents and skills can read/write work items via typed port interfaces, backed by the existing `work/items/*.md` markdown files — enabling programmatic work management without changing the human-readable file format.

### Approach

**Solution**: Class-based `MarkdownWorkItemAdapter` implementing both `WorkItemQueryPort` and `WorkItemCommandPort`. Three source files in `src/adapters/markdown/`: adapter logic, frontmatter parse/serialize helpers, and barrel export. Contract test suite parameterized by adapter factory for reuse with future adapters.

**Reuses**:

- `yaml` package (already root dep `^2.6.1`) — proven in `scripts/validate-docs-metadata.mjs`
- Frontmatter regex from `validate-docs-metadata.mjs`: `/^---\r?\n([\s\S]*?)\r?\n---/`
- ID allocation logic from `scripts/next-work-id.mjs` (max numeric suffix + 1, zero-padded to 4)
- `isValidTransition()` from `@cogni/work-items` for status enforcement
- `node:crypto` for SHA-256 revision hashing (zero external deps)
- `node:fs/promises` for file I/O (no `fast-glob` needed — flat directory scan via `readdir`)
- Adapter class pattern from `packages/db-client/src/adapters/` (constructor DI, implements port interface)

**Rejected**:

- **gray-matter**: Popular frontmatter library, but `yaml` is already in deps and the regex + parse/stringify approach is proven in the codebase. Adding gray-matter adds an unnecessary dependency.
- **Separate `packages/work-items-md/` package**: Over-engineering. The adapter is small, co-location follows `packages/db-client/src/adapters/` pattern, and `new-packages.md` recommends co-location.
- **Filesystem watcher / caching layer**: Premature optimization. With <200 files, re-reading on each call is fast enough. Caching adds complexity and staleness bugs.
- **Abstract base class**: Only one adapter exists. Extract if/when a second adapter (e.g., Drizzle) is needed.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] ROUND_TRIP_SAFE: Unknown frontmatter keys preserved on write — parse raw YAML object, extract known fields, merge changes back into raw object before stringify (spec: packages-architecture-spec)
- [ ] OPTIMISTIC_CONCURRENCY: Every write method checks SHA-256 revision of current frontmatter against `expectedRevision`; rejects with error on mismatch
- [ ] TRANSITION_ENFORCEMENT: `transitionStatus()` calls `isValidTransition(from, to)` before writing; rejects invalid transitions
- [ ] BODY_PRESERVED: Markdown body (everything after frontmatter) never modified by adapter writes
- [ ] SNAKE_CAMEL_MAP: Adapter maps between frontmatter snake_case (`spec_refs`, `blocked_by`, `deploy_verified`, `external_refs`, `claimed_by_run`, `claimed_at`, `last_command`) and TypeScript camelCase (`specRefs`, `blockedBy`, `deployVerified`, `externalRefs`, `claimedByRun`, `claimedAt`, `lastCommand`)
- [ ] ASSIGNEE_COMPAT: Plain string assignees in frontmatter (e.g., `derekg1729`) map to `{ kind: "user", userId: string }`; structured `SubjectRef` objects stored as-is
- [ ] ID_ALLOC_ATOMIC: `create()` scans all files for max numeric ID suffix, allocates next; filename matches `<type>.<NNNN>.<slug>.md`
- [ ] NO_SRC_IMPORTS: Adapter imports from `@cogni/work-items` types via relative `../../types.js` paths within the package, never `@/` or `src/` (spec: packages-architecture-spec)
- [ ] CONTRACT_TESTS_PORTABLE: Test suite accepts adapter factory function — same tests run against any `WorkItemQueryPort + WorkItemCommandPort` implementation

### Field Mapping

Frontmatter (snake_case) → WorkItem (camelCase):

| Frontmatter       | WorkItem              | Notes                                                      |
| ----------------- | --------------------- | ---------------------------------------------------------- |
| `id`              | `id`                  | Branded via `toWorkItemId()`                               |
| `type`            | `type`                | Direct map                                                 |
| `title`           | `title`               | Direct map                                                 |
| `status`          | `status`              | Direct map                                                 |
| `priority`        | `priority`            | Direct map                                                 |
| `rank`            | `rank`                | Direct map                                                 |
| `estimate`        | `estimate`            | Direct map                                                 |
| `summary`         | `summary`             | Direct map                                                 |
| `outcome`         | `outcome`             | Direct map                                                 |
| `project`         | `projectId`           | Branded via `toWorkItemId()`                               |
| `assignees`       | `assignees`           | String → `{ kind: "user", userId }`                        |
| `labels`          | `labels`              | Direct map (array)                                         |
| `spec_refs`       | `specRefs`            | snake → camel                                              |
| `branch`          | `branch`              | Direct map                                                 |
| `pr`              | `pr`                  | Direct map                                                 |
| `reviewer`        | `reviewer`            | Direct map                                                 |
| `revision`        | `revision`            | Frontmatter counter (number), NOT the concurrency Revision |
| `blocked_by`      | `blockedBy`           | Branded via `toWorkItemId()`                               |
| `deploy_verified` | `deployVerified`      | snake → camel                                              |
| `external_refs`   | `externalRefs`        | snake → camel, array of ExternalRef                        |
| `relations`       | (via `listRelations`) | Stored per-file, queried cross-file                        |
| `claimed_by_run`  | `claimedByRun`        | Operational field for agent locking                        |
| `claimed_at`      | `claimedAt`           | Operational field for agent locking                        |
| `last_command`    | `lastCommand`         | Operational field                                          |
| `created`         | `createdAt`           | Frontmatter `YYYY-MM-DD` → ISO string                      |
| `updated`         | `updatedAt`           | Frontmatter `YYYY-MM-DD` → ISO string                      |
| `credit`          | (not in WorkItem)     | Preserved as unknown field                                 |
| `parent`          | `parentId`            | If present, branded via `toWorkItemId()`                   |

**Revision strategy**: The `Revision` (optimistic concurrency token) is `SHA-256(raw frontmatter YAML)`. Computed on every read, checked on every write. Distinct from frontmatter `revision:` field (which is a numeric counter used by the review loop).

### File Layout

```
packages/work-items/
├── src/
│   ├── adapters/
│   │   └── markdown/
│   │       ├── index.ts          # Barrel: export { MarkdownWorkItemAdapter }
│   │       ├── adapter.ts        # Class implementing QueryPort + CommandPort
│   │       └── frontmatter.ts    # parseFrontmatter(), serializeFrontmatter(), computeRevision()
│   ├── index.ts                  # Add adapter re-export
│   ├── types.ts                  # (unchanged)
│   ├── ports.ts                  # (unchanged)
│   └── transitions.ts            # (unchanged)
├── tests/
│   ├── contract/
│   │   └── work-item-port.contract.ts   # Adapter-agnostic contract test suite
│   └── adapters/
│       └── markdown.test.ts             # Markdown adapter + contract suite binding
├── vitest.config.ts              # Package-local vitest config
├── package.json                  # Add yaml dep, update devDeps
└── tsup.config.ts                # Change platform: "node"
```

### Key Implementation Details

**`frontmatter.ts`** — Pure parse/serialize helpers:

```typescript
import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const FM_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

export function parseFrontmatter(content: string): {
  raw: Record<string, unknown>;  // Full parsed YAML (preserves unknown keys)
  body: string;                  // Everything after frontmatter
  revision: string;              // SHA-256 of raw YAML section
} { ... }

export function serializeFrontmatter(
  raw: Record<string, unknown>,
  body: string,
): string { ... }

export function computeRevision(yamlStr: string): string {
  return createHash("sha256").update(yamlStr).digest("hex");
}
```

**`adapter.ts`** — Constructor takes `workDir` (repo root):

```typescript
export class MarkdownWorkItemAdapter
  implements WorkItemQueryPort, WorkItemCommandPort
{
  constructor(private readonly workDir: string) {}

  // File discovery: readdir("work/items/") + filter *.md, skip _index.md/_archive/_templates
  // get(id): find file by scanning frontmatter IDs (no filename assumption beyond *.md)
  // list(query): scan all files, filter by query predicates, sort by priority/rank
  // create(): allocate next ID, write new file, return WorkItem
  // patch(): read file, check revision, merge changes, write back
  // transitionStatus(): read, check revision, validate transition, write
}
```

**Contract test suite** — Parameterized by factory:

```typescript
// contract/work-item-port.contract.ts
export function workItemPortContract(
  factory: () => Promise<{
    query: WorkItemQueryPort;
    command: WorkItemCommandPort;
    cleanup: () => Promise<void>;
  }>
): void {
  describe("WorkItemPort contract", () => {
    // create + get roundtrip
    // list with filters (status, type, project)
    // patch with valid revision succeeds
    // patch with stale revision throws
    // transitionStatus with valid transition succeeds
    // transitionStatus with invalid transition throws
    // setAssignees overwrites assignees
    // upsertRelation + listRelations roundtrip
    // removeRelation
    // upsertExternalRef
    // claim + release
    // unknown frontmatter keys preserved after patch
  });
}
```

### Package Wiring Changes

1. **`packages/work-items/package.json`**: Add `"yaml": "^2.6.1"` to dependencies; add `vitest` to devDeps. Add `"./markdown"` export entry point.
2. **`packages/work-items/tsup.config.ts`**: Add second entry `src/adapters/markdown/index.ts`; keep root entry `platform: "neutral"`, adapter entry `platform: "node"`
3. **`packages/work-items/src/index.ts`**: Do NOT re-export adapter (keep root entry pure types). Consumers use `@cogni/work-items/markdown`.
4. **`packages/work-items/AGENTS.md`**: Update responsibilities (now includes adapter), add `yaml` to external deps
5. **`packages/work-items/vitest.config.ts`**: New — package-local test config
6. **`scripts/validate-docs-metadata.mjs`**: Add `relations` and `claimed_by_run`, `claimed_at`, `last_command` to optional fields

### Error Types

- `StaleRevisionError`: Thrown by `patch()`, `transitionStatus()`, `setAssignees()`, `upsertExternalRef()` when `expectedRevision` doesn't match current SHA-256. Callers should re-read and retry.
- `InvalidTransitionError`: Thrown by `transitionStatus()` when `isValidTransition(from, to)` returns false.
- Both live in `src/adapters/markdown/errors.ts` (adapter-specific; port interface uses `Promise` rejection).

### Known Limitations

- **ID allocation race**: Two concurrent `create()` calls can allocate the same ID. v0 assumes single-caller (one agent at a time). Future: lockfile or counter file.
- **`listRelations()` is O(n)**: Scans all files for incoming relations. Acceptable for <200 files.

### Files

- Create: `packages/work-items/src/adapters/markdown/adapter.ts` — main adapter class
- Create: `packages/work-items/src/adapters/markdown/frontmatter.ts` — parse/serialize/revision helpers
- Create: `packages/work-items/src/adapters/markdown/errors.ts` — StaleRevisionError, InvalidTransitionError
- Create: `packages/work-items/src/adapters/markdown/index.ts` — barrel export
- Create: `packages/work-items/tests/contract/work-item-port.contract.ts` — portable contract tests
- Create: `packages/work-items/tests/adapters/markdown.test.ts` — markdown adapter test binding
- Create: `packages/work-items/vitest.config.ts` — package vitest config
- Modify: `packages/work-items/package.json` — add yaml dep, vitest devDep, `./markdown` export
- Modify: `packages/work-items/tsup.config.ts` — dual entry points, adapter platform: "node"
- Modify: `packages/work-items/AGENTS.md` — update responsibilities and deps
- Modify: `scripts/validate-docs-metadata.mjs` — accept new optional frontmatter fields

## Allowed Changes

- `packages/work-items/src/adapters/markdown/` (NEW) — adapter implementation
- `packages/work-items/tests/` — contract test suite (adapter-agnostic)
- `scripts/validate-docs-metadata.mjs` — accept `relations` and `external_refs` fields
- Root config files — tsconfig reference, workspace dep, biome overrides

## Plan

- [ ] **Checkpoint 1: Frontmatter helpers + package wiring**
  - Milestone: `parseFrontmatter()` / `serializeFrontmatter()` / `computeRevision()` work; package builds
  - Invariants: ROUND_TRIP_SAFE, BODY_PRESERVED, SNAKE_CAMEL_MAP
  - Todos:
    - [ ] Create `src/adapters/markdown/frontmatter.ts` — parse, serialize, revision, field mapping
    - [ ] Create `src/adapters/markdown/index.ts` — barrel
    - [ ] Update `package.json` — add `yaml` dep, `vitest` devDep
    - [ ] Update `tsup.config.ts` — `platform: "node"`
    - [ ] Create `vitest.config.ts`
  - Validation:
    - [ ] `pnpm packages:build && pnpm check` passes
    - [ ] Unit: frontmatter parse/serialize roundtrip preserves unknown keys + body

- [ ] **Checkpoint 2: Read path (QueryPort)**
  - Milestone: `get()`, `list()`, `listRelations()` work against real markdown files
  - Invariants: ASSIGNEE_COMPAT, SNAKE_CAMEL_MAP
  - Todos:
    - [ ] Create `src/adapters/markdown/adapter.ts` — `MarkdownWorkItemAdapter` class with read methods
    - [ ] Update `src/index.ts` — re-export adapter
  - Validation:
    - [ ] Contract tests: get by ID, list with filters, listRelations

- [ ] **Checkpoint 3: Write path (CommandPort)**
  - Milestone: All command methods work with optimistic concurrency
  - Invariants: OPTIMISTIC_CONCURRENCY, TRANSITION_ENFORCEMENT, ID_ALLOC_ATOMIC, ROUND_TRIP_SAFE
  - Todos:
    - [ ] Implement `create()` with ID allocation
    - [ ] Implement `patch()` with revision check
    - [ ] Implement `transitionStatus()` with `isValidTransition()` guard
    - [ ] Implement `setAssignees()`, `claim()`, `release()`
    - [ ] Implement `upsertRelation()`, `removeRelation()`, `upsertExternalRef()`
  - Validation:
    - [ ] Contract tests: create+get roundtrip, stale revision rejection, invalid transition rejection, claim/release

- [ ] **Checkpoint 4: Contract test suite + validator update + finalize**
  - Milestone: Full contract suite passes, validator accepts new fields, all checks green
  - Invariants: CONTRACT_TESTS_PORTABLE, NO_SRC_IMPORTS
  - Todos:
    - [ ] Create `tests/contract/work-item-port.contract.ts` — portable contract suite
    - [ ] Create `tests/adapters/markdown.test.ts` — bind markdown adapter to contract suite
    - [ ] Update `scripts/validate-docs-metadata.mjs` — accept `relations`, `claimed_by_run`, `claimed_at`, `last_command`
    - [ ] Update `packages/work-items/AGENTS.md` — reflect adapter responsibilities
  - Validation:
    - [ ] `pnpm test packages/work-items/tests/`
    - [ ] `pnpm check` passes

## Validation

**Command:**

```bash
pnpm test packages/work-items/tests/
pnpm check
```

**Expected:** All contract tests pass with markdown adapter. Existing checks green.

## Review Checklist

- [ ] **Work Item:** `task.0151` linked in PR body
- [ ] **Spec:** round-trip safety — unknown frontmatter keys preserved
- [ ] **Spec:** optimistic concurrency rejects stale writes
- [ ] **Tests:** contract tests cover all port methods + edge cases (missing file, collision, stale revision)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Project: proj.agentic-project-management
- Depends on: task.0149

## Attribution

- derekg1729 — design and project definition
