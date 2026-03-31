// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/work-items/adapters/markdown/frontmatter`
 * Purpose: Parse and serialize YAML frontmatter in markdown files, compute SHA-256 revision.
 * Scope: Pure helpers for frontmatter I/O. Does not read/write files directly.
 * Invariants:
 * - ROUND_TRIP_SAFE: Unknown YAML keys preserved on serialize.
 * - BODY_PRESERVED: Markdown body never modified.
 * - SNAKE_CAMEL_MAP: Adapter maps snake_case frontmatter to camelCase WorkItem fields.
 * Side-effects: none
 * Links: docs/spec/development-lifecycle.md
 * @public
 */

import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type {
  ExternalRef,
  SubjectRef,
  WorkItem,
  WorkItemId,
  WorkItemStatus,
  WorkItemType,
} from "../../types.js";
import { toWorkItemId } from "../../types.js";

// ── Frontmatter regex ────────────────────────────────
// Same pattern as scripts/validate-docs-metadata.mjs
const FM_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Parsed frontmatter result. */
export interface ParsedFrontmatter {
  /** Full parsed YAML object — preserves all keys including unknown ones. */
  readonly raw: Record<string, unknown>;
  /** Everything after the frontmatter closing `---`. */
  readonly body: string;
  /** SHA-256 hex digest of the raw YAML section (between `---` delimiters). */
  readonly revision: string;
}

/** Parse YAML frontmatter from a markdown file's content. */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(FM_REGEX);
  if (!match) {
    throw new Error("Missing YAML frontmatter (expected --- delimiters)");
  }

  const yamlStr = match[1] ?? "";
  const raw = parseYaml(yamlStr) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid YAML frontmatter (expected object)");
  }

  // Body is everything after the closing ---
  const closingIdx = content.indexOf("---", content.indexOf("---") + 3);
  const body = closingIdx >= 0 ? content.slice(closingIdx + 3) : "";

  return {
    raw,
    body,
    revision: computeRevision(yamlStr),
  };
}

/** Serialize frontmatter + body back to a markdown string. */
export function serializeFrontmatter(
  raw: Record<string, unknown>,
  body: string
): string {
  const yamlStr = stringifyYaml(raw, { lineWidth: 0 }).trimEnd();
  return `---\n${yamlStr}\n---${body}`;
}

/** Compute SHA-256 hex digest of a YAML string for optimistic concurrency. */
export function computeRevision(yamlStr: string): string {
  return createHash("sha256").update(yamlStr).digest("hex");
}

// ── Field mapping helpers ────────────────────────────

/** Convert a single assignee from frontmatter format to SubjectRef. */
function toSubjectRef(raw: unknown): SubjectRef {
  if (typeof raw === "string") {
    return { kind: "user", userId: raw };
  }
  if (raw && typeof raw === "object" && "kind" in raw) {
    return raw as SubjectRef;
  }
  return { kind: "user", userId: String(raw) };
}

/** Convert frontmatter assignees (string | string[] | SubjectRef[]) to SubjectRef[]. */
function toAssignees(raw: unknown): readonly SubjectRef[] {
  if (!raw) return [];
  if (typeof raw === "string") return [toSubjectRef(raw)];
  if (Array.isArray(raw)) return raw.map(toSubjectRef);
  return [];
}

/** Safely convert to string array. */
function toStringArray(raw: unknown): readonly string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return [];
}

/** Safely convert to ExternalRef array. */
function toExternalRefs(raw: unknown): readonly ExternalRef[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map((r) => ({
    system: String(r?.system ?? ""),
    kind: String(r?.kind ?? ""),
    externalId: r?.externalId ?? r?.external_id ?? undefined,
    url: r?.url ?? undefined,
    title: r?.title ?? undefined,
  }));
}

/** Map parsed frontmatter raw object to a WorkItem. */
export function rawToWorkItem(raw: Record<string, unknown>): WorkItem {
  return {
    id: toWorkItemId(String(raw.id ?? "")),
    type: String(raw.type ?? "task") as WorkItemType,
    title: String(raw.title ?? ""),
    status: String(raw.status ?? "needs_triage") as WorkItemStatus,
    priority: raw.priority != null ? Number(raw.priority) : undefined,
    rank: raw.rank != null ? Number(raw.rank) : undefined,
    estimate: raw.estimate != null ? Number(raw.estimate) : undefined,
    summary: raw.summary != null ? String(raw.summary) : undefined,
    outcome: raw.outcome != null ? String(raw.outcome) : undefined,
    projectId: raw.project ? toWorkItemId(String(raw.project)) : undefined,
    parentId: raw.parent ? toWorkItemId(String(raw.parent)) : undefined,
    actor: raw.actor === "human" || raw.actor === "ai" ? raw.actor : "either",
    assignees: toAssignees(raw.assignees),
    externalRefs: toExternalRefs(raw.external_refs),
    labels: toStringArray(raw.labels),
    specRefs: toStringArray(raw.spec_refs),
    branch: raw.branch != null ? String(raw.branch) : undefined,
    pr: raw.pr != null ? String(raw.pr) : undefined,
    reviewer: raw.reviewer != null ? String(raw.reviewer) : undefined,
    // WorkItem.revision is the frontmatter counter (number)
    revision: raw.revision != null ? Number(raw.revision) : 0,
    blockedBy: raw.blocked_by
      ? toWorkItemId(String(raw.blocked_by))
      : undefined,
    deployVerified: Boolean(raw.deploy_verified ?? false),
    claimedByRun:
      raw.claimed_by_run != null ? String(raw.claimed_by_run) : undefined,
    claimedAt: raw.claimed_at != null ? String(raw.claimed_at) : undefined,
    lastCommand:
      raw.last_command != null ? String(raw.last_command) : undefined,
    createdAt: String(raw.created ?? ""),
    updatedAt: String(raw.updated ?? ""),
  } satisfies WorkItem;
}

/** Map WorkItem camelCase fields back to frontmatter snake_case raw object. */
export function workItemFieldsToRaw(
  fields: Partial<
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
  >
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields.title !== undefined) out.title = fields.title;
  if (fields.summary !== undefined) out.summary = fields.summary;
  if (fields.outcome !== undefined) out.outcome = fields.outcome;
  if (fields.estimate !== undefined) out.estimate = fields.estimate;
  if (fields.priority !== undefined) out.priority = fields.priority;
  if (fields.rank !== undefined) out.rank = fields.rank;
  if (fields.specRefs !== undefined) out.spec_refs = fields.specRefs;
  if (fields.labels !== undefined) out.labels = fields.labels;
  if (fields.branch !== undefined) out.branch = fields.branch;
  if (fields.pr !== undefined) out.pr = fields.pr;
  if (fields.reviewer !== undefined) out.reviewer = fields.reviewer;
  return out;
}

/** Convert SubjectRef[] back to frontmatter format. */
export function assigneesToRaw(assignees: readonly SubjectRef[]): unknown[] {
  return assignees.map((a) => {
    if (a.kind === "user") return a.userId;
    return a;
  });
}

/** Convert WorkItemId to plain string for frontmatter. */
export function workItemIdToRaw(id: WorkItemId): string {
  return id as string;
}
