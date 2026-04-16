// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/work-items/types`
 * Purpose: Domain types for work item management — WorkItem, SubjectRef, ExternalRef, WorkRelation, WorkItemStatus.
 * Scope: Pure types and one boundary constructor. Does not perform I/O or depend on frameworks.
 * Invariants:
 * - STATUS_COMMAND_MAP: All 9 statuses from development-lifecycle.md
 * - ACTOR_KINDS_ALIGNED: SubjectRef kinds match identity-model.md actor kinds
 * - CANONICAL_RELATIONS: Only canonical directions (blocks, parent_of, relates_to, duplicates)
 * Side-effects: none
 * Links: docs/spec/development-lifecycle.md, docs/spec/identity-model.md
 * @public
 */

import type { Tagged } from "type-fest";

// ── Identity ──────────────────────────────────────────

/** Branded work item ID, e.g. "task.0149", "bug.0150", "proj.agentic-project-management". */
export type WorkItemId = Tagged<string, "WorkItemId">;

/** Adapter-specific revision token for optimistic concurrency (SHA-256 for markdown, row version for DB). */
export type Revision = string;

// ── Work item type ────────────────────────────────────

export type WorkItemType = "task" | "bug" | "story" | "spike" | "subtask";

// ── Actor eligibility ────────────────────────────────
// Routing hint for work selection: "safe for autonomous AI handling" (ai),
// "requires human judgement" (human), or "either can handle" (either).
// This is NOT provenance, ownership, or assignment — use `assignees` for that.

export type ActorKind = "human" | "ai" | "either";

// ── Status ────────────────────────────────────────────
// From docs/spec/development-lifecycle.md — 9 statuses, each needs_* maps to one /command.

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
// Aligned with docs/spec/identity-model.md actor kinds: user | agent | system.
// "org" kind omitted — not applicable to work item assignment.

export type SubjectRef =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "agent"; readonly agentId: string }
  | { readonly kind: "system"; readonly serviceId: string };

// ── External references ───────────────────────────────
// Backend-agnostic: works with GitHub, GitLab, Plane, OpenProject.

export type ExternalRef = {
  readonly system: string;
  readonly kind: string;
  readonly externalId?: string;
  readonly url?: string;
  readonly title?: string;
};

// ── Relations ─────────────────────────────────────────
// Canonical direction only — store "blocks", derive "blocked_by" at query time.

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
  readonly actor: ActorKind;
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
  readonly actor?: ActorKind;
  readonly limit?: number;
  readonly cursor?: string;
};

// ── Constructor helpers (boundary conversion) ─────────

/** Brand a raw string as WorkItemId. Call at system boundaries only. */
export function toWorkItemId(raw: string): WorkItemId {
  return raw as WorkItemId;
}
