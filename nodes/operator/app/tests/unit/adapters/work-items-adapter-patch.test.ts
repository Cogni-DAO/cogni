// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/work-items-adapter-patch`
 * Purpose: Drives DoltgresOperatorWorkItemAdapter.patch() with a fake `Sql`
 *   that captures issued SQL so we can assert deploy_verified / project_id /
 *   parent_id / blocked_by reach the UPDATE statement (bug.5005).
 * Scope: No real DB. Validates the PATCH_ALLOWLIST extension surgically.
 * Invariants:
 *   - PATCH_DEPLOY_VERIFIED: deployVerified:true emits `deploy_verified = TRUE`.
 *   - PATCH_NULLABLE_CLEAR: projectId:null emits `project_id = NULL`.
 *   - PATCH_PRESERVES_EXISTING: title still emits `title = '...'`.
 * Side-effects: none
 * Links: bug.5005,
 *   nodes/operator/app/src/adapters/server/db/doltgres/work-items-adapter.ts
 * @internal
 */

import { toWorkItemId } from "@cogni/work-items";
import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";

import { DoltgresOperatorWorkItemAdapter } from "@/adapters/server/db/doltgres/work-items-adapter";

function makeFakeSql(): { sql: Sql; queries: string[] } {
  const queries: string[] = [];
  const respond = (q: string): unknown[] => {
    if (q.startsWith("UPDATE work_items")) {
      return [
        {
          id: "bug.5005",
          type: "bug",
          title: "t",
          status: "needs_implement",
          node: "operator",
          actor: "either",
          assignees: [],
          external_refs: [],
          labels: [],
          spec_refs: [],
          revision: 0,
          deploy_verified: true,
          created_at: "2026-05-01",
          updated_at: "2026-05-01",
        },
      ];
    }
    if (q.startsWith("SELECT dolt_commit")) return [{}];
    if (q.startsWith("SELECT * FROM work_items")) return [];
    return [];
  };
  const fn = ((strings: TemplateStringsArray, ..._args: unknown[]) => {
    const q = Array.isArray(strings) ? strings.join("?") : String(strings);
    queries.push(q);
    return Promise.resolve(respond(q));
  }) as unknown as Sql;
  (fn as unknown as { unsafe: (q: string) => Promise<unknown[]> }).unsafe = (
    q: string
  ) => {
    queries.push(q);
    return Promise.resolve(respond(q));
  };
  return { sql: fn, queries };
}

describe("DoltgresOperatorWorkItemAdapter.patch — bug.5005 allowlist", () => {
  it("emits deploy_verified = TRUE for {deployVerified:true}", async () => {
    const { sql, queries } = makeFakeSql();
    const adapter = new DoltgresOperatorWorkItemAdapter(sql);
    await adapter.patch(
      { id: toWorkItemId("bug.5005"), set: { deployVerified: true } },
      "test"
    );
    const update = queries.find((q) => q.startsWith("UPDATE work_items"));
    expect(update).toBeDefined();
    expect(update).toContain("deploy_verified = TRUE");
  });

  it("emits project_id = NULL for {projectId:null}", async () => {
    const { sql, queries } = makeFakeSql();
    const adapter = new DoltgresOperatorWorkItemAdapter(sql);
    await adapter.patch(
      { id: toWorkItemId("bug.5005"), set: { projectId: null } },
      "test"
    );
    const update = queries.find((q) => q.startsWith("UPDATE work_items"));
    expect(update).toBeDefined();
    expect(update).toContain("project_id = NULL");
  });

  it("emits parent_id and blocked_by columns", async () => {
    const { sql, queries } = makeFakeSql();
    const adapter = new DoltgresOperatorWorkItemAdapter(sql);
    await adapter.patch(
      {
        id: toWorkItemId("bug.5005"),
        set: { parentId: toWorkItemId("task.5004"), blockedBy: null },
      },
      "test"
    );
    const update = queries.find((q) => q.startsWith("UPDATE work_items"));
    expect(update).toBeDefined();
    expect(update).toContain("parent_id = 'task.5004'");
    expect(update).toContain("blocked_by = NULL");
  });

  it("still emits the existing whitelisted columns (title)", async () => {
    const { sql, queries } = makeFakeSql();
    const adapter = new DoltgresOperatorWorkItemAdapter(sql);
    await adapter.patch(
      { id: toWorkItemId("bug.5005"), set: { title: "renamed" } },
      "test"
    );
    const update = queries.find((q) => q.startsWith("UPDATE work_items"));
    expect(update).toBeDefined();
    expect(update).toContain("title = 'renamed'");
  });
});
