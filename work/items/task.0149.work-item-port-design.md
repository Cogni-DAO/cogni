---
id: task.0149
type: task
title: "packages/work-items — port interfaces, domain types, and status transition table"
status: needs_implement
priority: 0
rank: 5
estimate: 2
summary: "Create a pure packages/work-items package with WorkItemQueryPort, WorkItemCommandPort interfaces, all domain types (WorkItem, SubjectRef, ExternalRef, WorkRelation, WorkItemStatus), and a status transition validation table derived from development-lifecycle.md."
outcome: "packages/work-items exports typed port interfaces and domain types. No I/O, no adapter code. The status transition table is a pure data structure that any adapter can use to validate transitions. Package builds and passes typecheck."
spec_refs: [identity-model-spec, development-lifecycle]
assignees: []
credit:
project: proj.agentic-project-management
branch: design/agentic-project-management
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-10
labels: [work-system, agents, infrastructure, ports]
external_refs:
---

# packages/work-items — port interfaces, domain types, and status transition table

## Requirements

- `WorkItemQueryPort` interface: `get(id)`, `list(query)`, `listRelations(id)`
- `WorkItemCommandPort` interface: `create()`, `patch()`, `transitionStatus()`, `setAssignees()`, `upsertRelation()`, `removeRelation()`, `upsertExternalRef()`, `claim()`, `release()`
- `WorkItem` type with all semantic fields modeled explicitly (no `Record<string, unknown>` bag)
- `WorkItemStatus` enum matching `development-lifecycle.md`
- `SubjectRef` discriminated union with kinds: `user | agent | system` — aligned with `identity-model.md` actor kinds
- `ExternalRef` type: `system + kind + externalId + url + title`
- `WorkRelation` type with canonical direction only: `blocks | parent_of | relates_to | duplicates`
- `WorkQuery` type with cursor field (for future adapters)
- `Revision` type for optimistic concurrency
- Status transition table: `Map<WorkItemStatus, WorkItemStatus[]>` derived from the lifecycle spec
- Zero I/O — pure types, interfaces, and data

## Allowed Changes

- `packages/work-items/` (NEW) — port interfaces, domain types, transition table
- Root `tsconfig.json` — add project reference
- Root `package.json` — add workspace dependency
- `biome/base.json` — add tsup/vitest overrides
- `.dependency-cruiser.cjs` — add boundary rule (if needed)

## Design

### Outcome

Agents and app code import `@cogni/work-items` to get typed port interfaces and domain types for work item management — enabling the markdown adapter (task.0151) and skill migration (task.0152) without coupling to any storage backend.

### Approach

**Solution**: Single `packages/work-items/` package exporting pure types, port interfaces, and a status transition table. Follows existing package conventions exactly (`@cogni/ids`, `@cogni/db-client`).

**Reuses**:

- `type-fest` `Tagged<>` for branded `WorkItemId` type (same as `@cogni/ids` `UserId`/`ActorId`)
- Existing package scaffold pattern from `@cogni/ids` (tsup, composite tsconfig, dist/ exports)
- Status values directly from `development-lifecycle.md` spec
- Actor kinds from `identity-model.md` spec

**Rejected**:

- **Zod schemas in the port package**: Would add a runtime dependency for what is primarily a type package. The adapter (task.0151) can add Zod validation at the boundary. Keep port package dependency-free.
- **Branded types for all IDs** (`Revision`, `WorkItemId`): `WorkItemId` benefits from branding (prevents mixing with other string IDs). `Revision` is adapter-specific (SHA-256 for markdown, DB row version for Drizzle) — keep as plain `string`.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] STATUS_COMMAND_MAP: All 9 statuses from `development-lifecycle.md` present in `WorkItemStatus` (spec: development-lifecycle)
- [ ] ACTOR_KINDS_ALIGNED: `SubjectRef` kinds match `identity-model.md` actor kinds: `user | agent | system` (spec: identity-model-spec)
- [ ] CANONICAL_RELATIONS: Only canonical directions stored: `blocks | parent_of | relates_to | duplicates`. No `blocked_by` or `child_of` (spec: proj.agentic-project-management)
- [ ] TRANSITION_TABLE_COMPLETE: Every status has defined valid transitions matching the lifecycle workflow diagram (spec: development-lifecycle)
- [ ] NO_IO: Package contains zero I/O — pure types, interfaces, and data constants only (spec: packages-architecture-spec PURE_LIBRARY)
- [ ] ESM_ONLY: Package builds as ESM, composite tsconfig, dist/ exports (spec: packages-architecture-spec)
- [ ] NO_SRC_IMPORTS: Package never imports from `src/` or `@/` aliases (spec: packages-architecture-spec)

### File Layout

```
packages/work-items/
├── src/
│   ├── index.ts              # Barrel export — all types, interfaces, constants
│   ├── types.ts              # Domain types: WorkItemId, WorkItem, SubjectRef, etc.
│   ├── ports.ts              # WorkItemQueryPort, WorkItemCommandPort interfaces
│   └── transitions.ts        # VALID_TRANSITIONS constant + isValidTransition()
├── package.json              # @cogni/work-items, private, ESM
├── tsconfig.json             # composite: true, outDir: dist
├── tsup.config.ts            # ESM, platform: neutral, single entry
├── AGENTS.md                 # Package boundaries doc
└── .gitignore                # dist/, *.tsbuildinfo
```

### Types Design

**`types.ts`** — all domain types:

```typescript
import type { Tagged } from "type-fest";

// ── Identity ──────────────────────────────────────────
export type WorkItemId = Tagged<string, "WorkItemId">; // branded, e.g. "task.0149"
export type Revision = string; // adapter-specific (SHA-256 for md, row version for DB)

// ── Work item type ────────────────────────────────────
export type WorkItemType = "task" | "bug" | "story" | "spike" | "subtask";

// ── Status ────────────────────────────────────────────
export type WorkItemStatus =
  | "needs_triage"
  | "needs_research"
  | "needs_design"
  | "needs_implement"
  | "needs_closeout"
  | "needs_merge"
  | "done"
  | "blocked"
  | "cancelled";

// ── Subject reference (assignment) ───────────────────
// Aligned with identity-model.md actor kinds
export type SubjectRef =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "agent"; readonly agentId: string }
  | { readonly kind: "system"; readonly serviceId: string };

// ── External references ───────────────────────────────
export type ExternalRef = {
  readonly system: string; // "github" | "gitlab" | "plane" | ...
  readonly kind: string; // "pull_request" | "issue" | "branch" | ...
  readonly externalId?: string;
  readonly url?: string;
  readonly title?: string;
};

// ── Relations ─────────────────────────────────────────
export type RelationType = "blocks" | "parent_of" | "relates_to" | "duplicates";

export type WorkRelation = {
  readonly fromId: WorkItemId;
  readonly toId: WorkItemId;
  readonly type: RelationType;
};

// ── Work item ─────────────────────────────────────────
export type WorkItem = {
  readonly id: WorkItemId;
  readonly type: WorkItemType;
  readonly title: string;
  readonly status: WorkItemStatus;
  readonly priority?: number;
  readonly rank?: number;
  readonly estimate?: number;
  readonly summary?: string;
  readonly outcome?: string;
  readonly projectId?: WorkItemId;
  readonly parentId?: WorkItemId;
  readonly assignees: readonly SubjectRef[];
  readonly externalRefs: readonly ExternalRef[];
  readonly labels: readonly string[];
  readonly specRefs: readonly string[];
  readonly branch?: string;
  readonly pr?: string;
  readonly reviewer?: string;
  readonly revision: number;
  readonly blockedBy?: WorkItemId;
  readonly deployVerified: boolean;
  readonly claimedByRun?: string;
  readonly claimedAt?: string;
  readonly lastCommand?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

// ── Query ─────────────────────────────────────────────
export type WorkQuery = {
  readonly ids?: readonly WorkItemId[];
  readonly types?: readonly WorkItemType[];
  readonly statuses?: readonly WorkItemStatus[];
  readonly assignee?: SubjectRef;
  readonly projectId?: WorkItemId;
  readonly relatedTo?: WorkItemId;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
};

// ── Constructor helpers (boundary conversion) ─────────
export function toWorkItemId(raw: string): WorkItemId {
  return raw as WorkItemId;
}
```

**`ports.ts`** — port interfaces:

```typescript
import type {
  ExternalRef,
  RelationType,
  Revision,
  SubjectRef,
  WorkItem,
  WorkItemId,
  WorkItemStatus,
  WorkItemType,
  WorkQuery,
  WorkRelation,
} from "./types.js";

// ── Query Port ────────────────────────────────────────
export interface WorkItemQueryPort {
  get(id: WorkItemId): Promise<WorkItem | null>;
  list(query?: WorkQuery): Promise<{ items: WorkItem[]; nextCursor?: string }>;
  listRelations(id: WorkItemId): Promise<WorkRelation[]>;
}

// ── Command Port ──────────────────────────────────────
export interface WorkItemCommandPort {
  create(input: {
    type: WorkItemType;
    title: string;
    summary?: string;
    outcome?: string;
    specRefs?: string[];
    projectId?: WorkItemId;
    parentId?: WorkItemId;
    labels?: string[];
    assignees?: SubjectRef[];
  }): Promise<WorkItem>;

  patch(input: {
    id: WorkItemId;
    expectedRevision: Revision;
    set?: Partial<
      Pick<
        WorkItem,
        | "title"
        | "summary"
        | "outcome"
        | "estimate"
        | "priority"
        | "rank"
        | "specRefs"
        | "labels"
        | "branch"
        | "pr"
        | "reviewer"
      >
    >;
  }): Promise<WorkItem>;

  transitionStatus(input: {
    id: WorkItemId;
    expectedRevision: Revision;
    toStatus: WorkItemStatus;
    reason?: string;
    blockedBy?: WorkItemId;
  }): Promise<WorkItem>;

  setAssignees(input: {
    id: WorkItemId;
    expectedRevision: Revision;
    assignees: SubjectRef[];
  }): Promise<WorkItem>;

  upsertRelation(rel: WorkRelation): Promise<void>;
  removeRelation(rel: {
    fromId: WorkItemId;
    toId: WorkItemId;
    type: RelationType;
  }): Promise<void>;

  upsertExternalRef(input: {
    id: WorkItemId;
    expectedRevision: Revision;
    ref: ExternalRef;
  }): Promise<WorkItem>;

  claim(input: {
    id: WorkItemId;
    runId: string;
    command: string;
  }): Promise<WorkItem>;

  release(input: { id: WorkItemId; runId: string }): Promise<WorkItem>;
}
```

**`transitions.ts`** — status transition table + validator:

```typescript
import type { WorkItemStatus } from "./types.js";

// Derived from docs/spec/development-lifecycle.md workflow diagram.
// Key: current status → Value: array of valid next statuses.
export const VALID_TRANSITIONS: ReadonlyMap<
  WorkItemStatus,
  readonly WorkItemStatus[]
> = new Map<WorkItemStatus, readonly WorkItemStatus[]>([
  // /triage dispatches from needs_triage
  [
    "needs_triage",
    [
      "needs_research",
      "needs_design",
      "needs_implement",
      "done",
      "blocked",
      "cancelled",
    ],
  ],
  // /research dispatches from needs_research
  ["needs_research", ["done", "blocked", "cancelled"]],
  // /design dispatches from needs_design
  ["needs_design", ["needs_implement", "blocked", "cancelled"]],
  // /implement dispatches from needs_implement
  ["needs_implement", ["needs_closeout", "blocked", "cancelled"]],
  // /closeout dispatches from needs_closeout
  ["needs_closeout", ["needs_merge", "blocked", "cancelled"]],
  // /review-implementation dispatches from needs_merge
  ["needs_merge", ["done", "needs_implement", "blocked", "cancelled"]],
  // Terminal states — no outbound transitions (except unblock)
  ["done", []],
  [
    "blocked",
    [
      "needs_triage",
      "needs_research",
      "needs_design",
      "needs_implement",
      "needs_closeout",
      "needs_merge",
      "cancelled",
    ],
  ],
  ["cancelled", []],
]);

export function isValidTransition(
  from: WorkItemStatus,
  to: WorkItemStatus
): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed != null && allowed.includes(to);
}
```

**`index.ts`** — barrel export:

```typescript
export * from "./types.js";
export * from "./ports.js";
export { VALID_TRANSITIONS, isValidTransition } from "./transitions.js";
```

### Package Wiring

Following the checklist from `packages-architecture.md` and `new-packages.md`:

1. **Root `package.json`**: Add `"@cogni/work-items": "workspace:*"` to `dependencies`
2. **Root `tsconfig.json`**: Add `{ "path": "./packages/work-items" }` to `references`
3. **`biome/base.json`**: Add `packages/work-items/tsup.config.ts` to `noDefaultExport` override
4. **`packages/work-items/package.json`**: Standard structure — `@cogni/work-items`, `private: true`, ESM, exports to `dist/`
5. **`packages/work-items/tsconfig.json`**: `composite: true`, `outDir: dist`, `rootDir: src`, `platform: neutral`
6. **Dependencies**: Only `type-fest` (for `Tagged<>` branded type)

### Files

- Create: `packages/work-items/src/types.ts` — all domain types
- Create: `packages/work-items/src/ports.ts` — query + command port interfaces
- Create: `packages/work-items/src/transitions.ts` — VALID_TRANSITIONS map + isValidTransition
- Create: `packages/work-items/src/index.ts` — barrel export
- Create: `packages/work-items/package.json` — workspace package config
- Create: `packages/work-items/tsconfig.json` — composite TS config
- Create: `packages/work-items/tsup.config.ts` — build config
- Create: `packages/work-items/AGENTS.md` — package boundaries doc
- Create: `packages/work-items/.gitignore` — dist/, \*.tsbuildinfo
- Modify: `tsconfig.json` (root) — add project reference
- Modify: `package.json` (root) — add workspace dependency
- Modify: `biome/base.json` — add tsup config to noDefaultExport override

## Plan

- [ ] Create `packages/work-items/` with standard package structure
- [ ] Define domain types in `src/types.ts`
- [ ] Define port interfaces in `src/ports.ts`
- [ ] Define transition table in `src/transitions.ts`
- [ ] Wire barrel export in `src/index.ts`
- [ ] Wire package into build (root tsconfig, package.json, biome)
- [ ] Verify `pnpm packages:build && pnpm check` passes

## Validation

**Command:**

```bash
pnpm packages:build
pnpm check
```

**Expected:** Package builds, types are exported, all checks green. No tests yet (pure types only — contract tests come in task.0151).

## Review Checklist

- [ ] **Work Item:** `task.0149` linked in PR body
- [ ] **Spec:** identity-model actor kinds respected in SubjectRef
- [ ] **Spec:** development-lifecycle transitions encoded in transition table
- [ ] **Architecture:** package follows packages-architecture.md conventions
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Project: proj.agentic-project-management

## Attribution

- derekg1729 — design and project definition
