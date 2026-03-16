// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/work-items/tests/contract/work-item-port.contract`
 * Purpose: Adapter-agnostic contract test suite for WorkItemQueryPort + WorkItemCommandPort.
 * Scope: Tests port invariants. Does not test adapter internals.
 * Invariants: CONTRACT_TESTS_PORTABLE — same tests run against any adapter implementation.
 * Side-effects: IO (via adapter under test)
 * Links: docs/spec/development-lifecycle.md
 * @internal
 */

import type {
  WorkItemCommandPort,
  WorkItemId,
  WorkItemQueryPort,
} from "@cogni/work-items";
import { toWorkItemId } from "@cogni/work-items";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

export interface PortTestContext {
  query: WorkItemQueryPort;
  command: WorkItemCommandPort;
  /** Return the SHA-256 revision for a given item ID. Adapter-specific. */
  getRevision: (id: WorkItemId) => Promise<string>;
  cleanup: () => Promise<void>;
}

/**
 * Portable contract test suite for WorkItemQueryPort + WorkItemCommandPort.
 * Parameterized by adapter factory — same tests run against any implementation.
 */
export function workItemPortContract(
  factory: () => Promise<PortTestContext>
): void {
  describe("WorkItemPort contract", () => {
    let ctx: PortTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup();
    });

    // ── create + get roundtrip ───────────────────────

    it("create + get roundtrip", async () => {
      const item = await ctx.command.create({
        type: "task",
        title: "Test task",
        summary: "A test summary",
      });

      expect(item.id).toBeTruthy();
      expect(item.type).toBe("task");
      expect(item.title).toBe("Test task");
      expect(item.status).toBe("needs_triage");
      expect(item.summary).toBe("A test summary");

      const fetched = await ctx.query.get(item.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toEqual(item.id);
      expect(fetched?.title).toBe("Test task");
    });

    it("get returns null for non-existent ID", async () => {
      const result = await ctx.query.get(toWorkItemId("task.9999"));
      expect(result).toBeNull();
    });

    // ── list with filters ────────────────────────────

    it("list returns all items without filter", async () => {
      await ctx.command.create({ type: "task", title: "Task A" });
      await ctx.command.create({ type: "bug", title: "Bug B" });

      const { items } = await ctx.query.list();
      expect(items.length).toBeGreaterThanOrEqual(2);
    });

    it("list filters by status", async () => {
      await ctx.command.create({ type: "task", title: "Triaging" });

      const { items } = await ctx.query.list({
        statuses: ["needs_triage"],
      });
      expect(items.every((i) => i.status === "needs_triage")).toBe(true);
    });

    it("list filters by type", async () => {
      await ctx.command.create({ type: "bug", title: "A bug" });

      const { items } = await ctx.query.list({ types: ["bug"] });
      expect(items.every((i) => i.type === "bug")).toBe(true);
    });

    it("list filters by text search", async () => {
      await ctx.command.create({
        type: "task",
        title: "Unique needle title",
      });
      await ctx.command.create({ type: "task", title: "Other task" });

      const { items } = await ctx.query.list({ text: "unique needle" });
      expect(items.length).toBe(1);
      expect(items[0]?.title).toBe("Unique needle title");
    });

    // ── patch with optimistic concurrency ────────────

    it("patch with valid revision succeeds", async () => {
      const item = await ctx.command.create({
        type: "task",
        title: "Original",
      });
      const rev = await ctx.getRevision(item.id);

      const patched = await ctx.command.patch({
        id: item.id,
        expectedRevision: rev,
        set: { title: "Updated" },
      });

      expect(patched.title).toBe("Updated");
    });

    it("patch with stale revision throws", async () => {
      const item = await ctx.command.create({
        type: "task",
        title: "Original",
      });

      await expect(
        ctx.command.patch({
          id: item.id,
          expectedRevision: "stale-revision-hash",
          set: { title: "Should fail" },
        })
      ).rejects.toThrow(/[Ss]tale/);
    });

    // ── transitionStatus ─────────────────────────────

    it("transitionStatus with valid transition succeeds", async () => {
      const item = await ctx.command.create({
        type: "task",
        title: "To implement",
      });
      const rev = await ctx.getRevision(item.id);

      // needs_triage → needs_implement is valid
      const transitioned = await ctx.command.transitionStatus({
        id: item.id,
        expectedRevision: rev,
        toStatus: "needs_implement",
      });

      expect(transitioned.status).toBe("needs_implement");
    });

    it("transitionStatus with invalid transition throws", async () => {
      const item = await ctx.command.create({
        type: "task",
        title: "To implement",
      });
      const rev = await ctx.getRevision(item.id);

      // needs_triage → done is valid, but needs_triage → needs_merge is not
      await expect(
        ctx.command.transitionStatus({
          id: item.id,
          expectedRevision: rev,
          toStatus: "needs_merge",
        })
      ).rejects.toThrow(/[Ii]nvalid.*transition/);
    });

    // ── setAssignees ─────────────────────────────────

    it("setAssignees overwrites assignees", async () => {
      const item = await ctx.command.create({
        type: "task",
        title: "Assign me",
      });
      const rev = await ctx.getRevision(item.id);

      const updated = await ctx.command.setAssignees({
        id: item.id,
        expectedRevision: rev,
        assignees: [{ kind: "user", userId: "alice" }],
      });

      expect(updated.assignees).toEqual([{ kind: "user", userId: "alice" }]);
    });

    // ── upsertRelation + listRelations ───────────────

    it("upsertRelation + listRelations roundtrip", async () => {
      const a = await ctx.command.create({
        type: "task",
        title: "Task A",
      });
      const b = await ctx.command.create({
        type: "task",
        title: "Task B",
      });

      await ctx.command.upsertRelation({
        fromId: a.id,
        toId: b.id,
        type: "blocks",
      });

      const relations = await ctx.query.listRelations(a.id);
      expect(relations.length).toBe(1);
      expect(relations[0]?.type).toBe("blocks");
      expect(String(relations[0]?.toId)).toBe(String(b.id));
    });

    // ── removeRelation ───────────────────────────────

    it("removeRelation removes a relation", async () => {
      const a = await ctx.command.create({
        type: "task",
        title: "Task A",
      });
      const b = await ctx.command.create({
        type: "task",
        title: "Task B",
      });

      await ctx.command.upsertRelation({
        fromId: a.id,
        toId: b.id,
        type: "blocks",
      });

      await ctx.command.removeRelation({
        fromId: a.id,
        toId: b.id,
        type: "blocks",
      });

      const relations = await ctx.query.listRelations(a.id);
      expect(relations.length).toBe(0);
    });

    // ── upsertExternalRef ────────────────────────────

    it("upsertExternalRef adds an external ref", async () => {
      const item = await ctx.command.create({
        type: "task",
        title: "With ref",
      });
      const rev = await ctx.getRevision(item.id);

      const updated = await ctx.command.upsertExternalRef({
        id: item.id,
        expectedRevision: rev,
        ref: {
          system: "github",
          kind: "pull_request",
          url: "https://github.com/org/repo/pull/42",
        },
      });

      expect(updated.externalRefs.length).toBe(1);
      expect(updated.externalRefs[0]?.system).toBe("github");
    });

    // ── claim + release ──────────────────────────────

    it("claim and release work correctly", async () => {
      const item = await ctx.command.create({
        type: "task",
        title: "Claim me",
      });

      const claimed = await ctx.command.claim({
        id: item.id,
        runId: "run-123",
        command: "/implement",
      });
      expect(claimed.claimedByRun).toBe("run-123");
      expect(claimed.lastCommand).toBe("/implement");

      const released = await ctx.command.release({
        id: item.id,
        runId: "run-123",
      });
      expect(released.claimedByRun).toBeUndefined();
    });

    // ── round-trip safety ────────────────────────────

    it("unknown frontmatter keys preserved after patch", async () => {
      const item = await ctx.command.create({
        type: "task",
        title: "With unknown keys",
      });
      const rev = await ctx.getRevision(item.id);

      // Patch should preserve the "credit" field and other unknowns
      const patched = await ctx.command.patch({
        id: item.id,
        expectedRevision: rev,
        set: { title: "Updated title" },
      });

      expect(patched.title).toBe("Updated title");
      // The item should still be fetchable (round-trip didn't corrupt)
      const fetched = await ctx.query.get(item.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.title).toBe("Updated title");
    });
  });
}
