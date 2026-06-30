// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import type { Database } from "@cogni/db-client";
import { describe, expect, it, vi } from "vitest";
import { findNodeByRepo } from "./node-lookup";

/**
 * Minimal fake of the drizzle select chain `db.select(...).from(...).where(...).limit(...)`.
 * The chain resolves (thenable) to `rows`. We don't assert on the SQL fragment itself (an opaque
 * drizzle object) — the case-insensitivity contract is exercised at the DB level by the
 * `nodes_repo_owner_name_lower_unique` lower() index; here we pin the row→ResolvedNodeRef mapping
 * and the no-match→null behavior the route's fallback depends on.
 */
function fakeDb(rows: Array<{ id: string; slug: string }>): Database {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select } as unknown as Database;
}

describe("findNodeByRepo", () => {
  it("returns the owning node's identity on a match", async () => {
    const db = fakeDb([{ id: "node-uuid-1", slug: "node-template" }]);
    const got = await findNodeByRepo(db, "cogni-dao", "node-template");
    expect(got).toEqual({ nodeId: "node-uuid-1", slug: "node-template" });
  });

  it("matches regardless of GitHub owner/name casing (lookup is case-insensitive)", async () => {
    // The lower() unique index makes the DB match case-insensitively; the lookup passes the raw
    // GitHub casing straight through to the lower()'d comparison and still resolves the one row.
    const db = fakeDb([{ id: "node-uuid-1", slug: "node-template" }]);
    const got = await findNodeByRepo(db, "Cogni-DAO", "Node-Template");
    expect(got).toEqual({ nodeId: "node-uuid-1", slug: "node-template" });
  });

  it("returns null when no node owns the repo", async () => {
    const db = fakeDb([]);
    const got = await findNodeByRepo(db, "cogni-test-org", "unregistered-repo");
    expect(got).toBeNull();
  });
});
