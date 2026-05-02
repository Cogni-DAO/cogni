// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/db/doltgres/work-items-adapter`
 * Purpose: Operator-local Doltgres adapter for work_items — implements the v0 surface (Query + create + patch) for task.0424.
 * Scope: Reads/writes `work_items` in `knowledge_operator`. Auto-commits on every write per AUTO_COMMIT_ON_WRITE.
 * Invariants:
 *   - SQL_UNSAFE_TARGETED: All CRUD via sql.unsafe() with escapeValue() — postgres.js extended-protocol path raises `unhandled message "&{}"` on Doltgres 0.56.2 for parameterized SELECT/INSERT/UPDATE. Same workaround as `@cogni/knowledge-store` adapter. Removable when upstream closes the gap.
 *   - AUTO_COMMIT_ON_WRITE: Each create/patch issues `dolt_commit('-Am', ...)` before returning.
 *   - AUTHOR_ATTRIBUTED: dolt_commit messages embed an `authorTag` derived from `getSessionUser`.
 *   - ID_RANGE_RESERVED: Allocator floor is 5000 per type.
 *   - PATCH_ALLOWLIST: Only fields enumerated in `WorkItemsPatchSet` are mutable.
 *   - OPERATOR_LOCAL_ADAPTER_V0: Lives here, NOT in packages/work-items/.
 *   - KEYSET_PAGINATION: list() uses (priority,rank,createdAt,id) keyset cursor —
 *     OFFSET would scan all skipped rows and breaks under concurrent writes
 *     (bug.5162). Sort order is priority ASC, rank ASC, created_at DESC, id ASC.
 * Side-effects: IO (database reads/writes; dolt_commit calls).
 * Links: docs/spec/work-items-port.md, work/items/task.0424.doltgres-work-items-source-of-truth.md
 * @public
 */

import type {
  ActorKind,
  SubjectRef,
  WorkItem,
  WorkItemId,
  WorkItemStatus,
  WorkItemType,
  WorkQuery,
} from "@cogni/work-items";
import { toWorkItemId } from "@cogni/work-items";
import type { Sql } from "postgres";

import type {
  WorkItemsCreateInput,
  WorkItemsDoltgresPort,
  WorkItemsPatchInput,
  WorkItemsPatchSet,
} from "@/ports/server";

import {
  decodeCursor,
  encodeCursor,
  type WorkItemCursor,
} from "./work-items-cursor";

const ID_FLOOR = 5000;

export class WorkItemAlreadyExistsError extends Error {
  constructor(public readonly id: string) {
    super(`work item id '${id}' already exists`);
    this.name = "WorkItemAlreadyExistsError";
  }
}

function escapeValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") {
    if (!Number.isFinite(val)) throw new Error("Non-finite number");
    return String(val);
  }
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (Array.isArray(val) || typeof val === "object") {
    return `'${JSON.stringify(val).replace(/\0/g, "").replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(val).replace(/\0/g, "").replace(/'/g, "''")}'`;
}

function actorOf(v: unknown): ActorKind {
  return v === "human" || v === "ai" ? v : "either";
}

function jsonArrayOf<T>(v: unknown): readonly T[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function workItemIdOrNullable(v: unknown): WorkItemId | undefined {
  return v ? toWorkItemId(String(v)) : undefined;
}

function strOrNullable(v: unknown): string | undefined {
  return v === null || v === undefined ? undefined : String(v);
}

function numOrNullable(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function rowToWorkItem(row: Record<string, unknown>): WorkItem {
  const required = {
    id: toWorkItemId(String(row.id)),
    type: String(row.type) as WorkItemType,
    title: String(row.title),
    status: String(row.status) as WorkItemStatus,
    node: String(row.node ?? "shared"),
    actor: actorOf(row.actor),
    assignees: jsonArrayOf<SubjectRef>(row.assignees),
    externalRefs: jsonArrayOf<WorkItem["externalRefs"][number]>(
      row.external_refs
    ),
    labels: jsonArrayOf<string>(row.labels),
    specRefs: jsonArrayOf<string>(row.spec_refs),
    revision: Number(row.revision ?? 0),
    deployVerified: Boolean(row.deploy_verified ?? false),
    createdAt: row.created_at ? String(row.created_at) : "",
    updatedAt: row.updated_at ? String(row.updated_at) : "",
  };
  const out: Record<string, unknown> = { ...required };
  const optional = {
    priority: numOrNullable(row.priority),
    rank: numOrNullable(row.rank),
    estimate: numOrNullable(row.estimate),
    summary: strOrNullable(row.summary),
    outcome: strOrNullable(row.outcome),
    projectId: workItemIdOrNullable(row.project_id),
    parentId: workItemIdOrNullable(row.parent_id),
    branch: strOrNullable(row.branch),
    pr: strOrNullable(row.pr),
    reviewer: strOrNullable(row.reviewer),
    blockedBy: workItemIdOrNullable(row.blocked_by),
    claimedByRun: strOrNullable(row.claimed_by_run),
    claimedAt: strOrNullable(row.claimed_at),
    lastCommand: strOrNullable(row.last_command),
  };
  for (const [k, v] of Object.entries(optional)) {
    if (v !== undefined) out[k] = v;
  }
  return out as WorkItem;
}

function parseSuffix(id: string, type: WorkItemType): number | null {
  const prefix = `${type}.`;
  if (!id.startsWith(prefix)) return null;
  const tail = id.slice(prefix.length);
  return /^\d+$/.test(tail) ? Number.parseInt(tail, 10) : null;
}

const PATCH_COLUMNS: Record<keyof WorkItemsPatchSet, string> = {
  title: "title",
  summary: "summary",
  outcome: "outcome",
  status: "status",
  priority: "priority",
  rank: "rank",
  estimate: "estimate",
  labels: "labels",
  specRefs: "spec_refs",
  branch: "branch",
  pr: "pr",
  reviewer: "reviewer",
  node: "node",
  deployVerified: "deploy_verified",
  projectId: "project_id",
  parentId: "parent_id",
  blockedBy: "blocked_by",
};

export class DoltgresOperatorWorkItemAdapter implements WorkItemsDoltgresPort {
  constructor(private readonly sql: Sql) {}

  async get(id: WorkItemId): Promise<WorkItem | null> {
    const rows = await this.sql.unsafe(
      `SELECT * FROM work_items WHERE id = ${escapeValue(id as string)} LIMIT 1`
    );
    return rows.length > 0
      ? rowToWorkItem(rows[0] as Record<string, unknown>)
      : null;
  }

  async list(query: WorkQuery = {}): Promise<{
    items: WorkItem[];
    nextCursor?: string;
    pageInfo: { endCursor: string | null; hasMore: boolean };
  }> {
    const conds: string[] = [];

    if (query.ids?.length) {
      const ids = query.ids.map((id) => escapeValue(id as string)).join(", ");
      conds.push(`id IN (${ids})`);
    }
    if (query.types?.length) {
      conds.push(`type IN (${query.types.map(escapeValue).join(", ")})`);
    }
    if (query.statuses?.length) {
      conds.push(`status IN (${query.statuses.map(escapeValue).join(", ")})`);
    }
    if (query.projectId) {
      conds.push(`project_id = ${escapeValue(query.projectId as string)}`);
    }
    if (query.node) {
      const nodes = Array.isArray(query.node) ? query.node : [query.node];
      conds.push(`node IN (${nodes.map(escapeValue).join(", ")})`);
    }
    if (query.text) {
      const escaped = query.text.toLowerCase().replace(/[%_\\]/g, "\\$&");
      const pat = escapeValue(`%${escaped}%`);
      conds.push(
        `(LOWER(title) LIKE ${pat} OR LOWER(COALESCE(summary,'')) LIKE ${pat})`
      );
    }

    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      const pEff = c.p ?? 999;
      const rEff = c.r ?? 999;
      const ts = escapeValue(c.ts);
      const id = escapeValue(c.id);
      // Keyset progression for ORDER BY
      //   COALESCE(priority,999) ASC, COALESCE(rank,999) ASC, created_at DESC, id ASC.
      // Mixed directions → expressed as OR-chain rather than tuple compare.
      conds.push(
        `(` +
          `COALESCE(priority,999) > ${pEff}` +
          ` OR (COALESCE(priority,999) = ${pEff} AND COALESCE(rank,999) > ${rEff})` +
          ` OR (COALESCE(priority,999) = ${pEff} AND COALESCE(rank,999) = ${rEff} AND created_at < ${ts})` +
          ` OR (COALESCE(priority,999) = ${pEff} AND COALESCE(rank,999) = ${rEff} AND created_at = ${ts} AND id > ${id})` +
          `)`
      );
    }

    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
    const requestedLimit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    // Fetch limit+1 to detect hasMore without a separate COUNT query.
    const fetchLimit = requestedLimit + 1;

    const rows = (await this.sql.unsafe(
      `SELECT * FROM work_items ${where} ORDER BY COALESCE(priority, 999) ASC, COALESCE(rank, 999) ASC, created_at DESC, id ASC LIMIT ${fetchLimit}`
    )) as ReadonlyArray<Record<string, unknown>>;

    const hasMore = rows.length > requestedLimit;
    const pageRows = hasMore ? rows.slice(0, requestedLimit) : rows;
    const items = pageRows.map((r) => rowToWorkItem(r));

    let endCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1] as Record<string, unknown>;
      const cursor: WorkItemCursor = {
        p:
          last.priority === null || last.priority === undefined
            ? null
            : Number(last.priority),
        r:
          last.rank === null || last.rank === undefined
            ? null
            : Number(last.rank),
        ts:
          last.created_at instanceof Date
            ? last.created_at.toISOString()
            : String(last.created_at ?? ""),
        id: String(last.id),
      };
      endCursor = encodeCursor(cursor);
    }

    return {
      items,
      pageInfo: { endCursor, hasMore },
      ...(endCursor !== null && { nextCursor: endCursor }),
    };
  }

  async create(
    input: WorkItemsCreateInput,
    authorTag: string
  ): Promise<WorkItem> {
    let allocatedId: string;
    if (input.id) {
      const requested = String(input.id);
      const expectedPrefix = `${input.type}.`;
      if (!requested.startsWith(expectedPrefix)) {
        throw new Error(
          `Provided id '${requested}' does not match type '${input.type}'`
        );
      }
      const existing = await this.sql.unsafe(
        `SELECT id FROM work_items WHERE id = ${escapeValue(requested)} LIMIT 1`
      );
      if (existing.length > 0) {
        throw new WorkItemAlreadyExistsError(requested);
      }
      allocatedId = requested;
    } else {
      const idRows = await this.sql.unsafe(
        `SELECT id FROM work_items WHERE type = ${escapeValue(input.type)}`
      );
      let maxSuffix = ID_FLOOR - 1;
      for (const r of idRows as ReadonlyArray<Record<string, unknown>>) {
        const suffix = parseSuffix(String(r.id), input.type);
        if (suffix !== null && suffix > maxSuffix) maxSuffix = suffix;
      }
      allocatedId = `${input.type}.${String(maxSuffix + 1).padStart(4, "0")}`;
    }

    const cols: string[] = ["id", "type", "title", "status", "node"];
    const vals: string[] = [
      escapeValue(allocatedId),
      escapeValue(input.type),
      escapeValue(input.title),
      escapeValue(input.status ?? "needs_triage"),
      escapeValue(input.node ?? "shared"),
    ];
    const addCol = (name: string, value: unknown) => {
      if (value === undefined) return;
      cols.push(name);
      vals.push(escapeValue(value));
    };

    addCol("summary", input.summary);
    addCol("outcome", input.outcome);
    addCol("project_id", input.projectId);
    addCol("parent_id", input.parentId);
    addCol("priority", input.priority);
    addCol("rank", input.rank);
    addCol("estimate", input.estimate);
    if (input.assignees) addCol("assignees", input.assignees);
    if (input.labels) addCol("labels", input.labels);
    if (input.specRefs) addCol("spec_refs", input.specRefs);

    const inserted = await this.sql.unsafe(
      `INSERT INTO work_items (${cols.join(", ")}) VALUES (${vals.join(", ")}) RETURNING *`
    );
    const row = inserted[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("INSERT returned no row");

    await this.sql.unsafe(
      `SELECT dolt_commit('-Am', ${escapeValue(`task.0424: create ${allocatedId} by ${authorTag}`)})`
    );

    return rowToWorkItem(row);
  }

  async patch(
    input: WorkItemsPatchInput,
    authorTag: string
  ): Promise<WorkItem | null> {
    const setClauses: string[] = [];
    for (const [key, col] of Object.entries(PATCH_COLUMNS) as [
      keyof WorkItemsPatchSet,
      string,
    ][]) {
      const value = input.set[key];
      if (value === undefined) continue;
      setClauses.push(`${col} = ${escapeValue(value)}`);
    }
    if (setClauses.length === 0) {
      return this.get(input.id);
    }
    setClauses.push("updated_at = NOW()");

    const updated = await this.sql.unsafe(
      `UPDATE work_items SET ${setClauses.join(", ")} WHERE id = ${escapeValue(input.id as string)} RETURNING *`
    );
    const row = updated[0] as Record<string, unknown> | undefined;
    if (!row) return null;

    await this.sql.unsafe(
      `SELECT dolt_commit('-Am', ${escapeValue(`task.0424: patch ${input.id as string} by ${authorTag}`)})`
    );

    return rowToWorkItem(row);
  }
}
