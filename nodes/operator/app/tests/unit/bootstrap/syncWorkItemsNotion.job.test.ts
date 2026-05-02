// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/syncWorkItemsNotion.job`
 * Purpose: Unit tests for the Notion work-item sync orchestration job.
 * Scope: Mocks Dolt and Notion ports; verifies create, patch, conflict, and validation-error flows.
 * Invariants:
 *   - DOLT_IS_SOURCE_OF_TRUTH: Notion edits patch Dolt first, then canonical Dolt state is projected back
 *   - CONFLICTS_VISIBLE: Concurrent edits mark the Notion page instead of overwriting Dolt
 * Side-effects: none
 * Links: src/bootstrap/jobs/syncWorkItemsNotion.job.ts
 * @internal
 */

import type { WorkItem } from "@cogni/work-items";
import { toWorkItemId } from "@cogni/work-items";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mirror = {
    listPages: vi.fn(),
    markConflict: vi.fn(),
    markError: vi.fn(),
    hashPage: vi.fn(),
    hashItem: vi.fn(),
    patchFromPage: vi.fn(),
    upsertItem: vi.fn(),
  };

  return {
    mirror,
    serverEnv: vi.fn(),
    getContainer: vi.fn(),
    NotionWorkItemMirror: vi.fn(function NotionWorkItemMirror() {
      return mirror;
    }),
  };
});

vi.mock("@/shared/env/server-env", () => ({
  serverEnv: () => mocks.serverEnv(),
}));

vi.mock("@/bootstrap/container", () => ({
  getContainer: () => mocks.getContainer(),
}));

vi.mock("@cogni/work-items/notion", () => ({
  NotionWorkItemMirror: mocks.NotionWorkItemMirror,
}));

import { runWorkItemsNotionSyncJob } from "@/bootstrap/jobs/syncWorkItemsNotion.job";

const baseItem: WorkItem = {
  id: toWorkItemId("task.5067"),
  type: "task",
  title: "Create Grafana Cloud P0 alert rules",
  status: "needs_triage",
  node: "operator",
  assignees: [],
  externalRefs: [],
  actor: "ai",
  labels: [],
  specRefs: [],
  revision: 1,
  deployVerified: false,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

const patchedItem: WorkItem = {
  ...baseItem,
  status: "done",
  revision: 2,
};

function page(overrides: Record<string, unknown> = {}) {
  return {
    pageId: "page_test",
    lastEditedTime: "2026-05-01T00:00:00.000Z",
    cogniId: baseItem.id,
    syncHash: "synced",
    validationErrors: [],
    editable: { status: "done" },
    ...overrides,
  };
}

describe("runWorkItemsNotionSyncJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverEnv.mockReturnValue({
      WORK_ITEMS_NOTION_TOKEN: "secret_test",
      WORK_ITEMS_NOTION_DATA_SOURCE_ID: "source_test",
    });
    mocks.getContainer.mockReturnValue({
      doltgresWorkItems: {
        list: vi.fn().mockResolvedValue({ items: [baseItem] }),
        patch: vi.fn().mockResolvedValue(patchedItem),
      },
    });
    mocks.mirror.listPages.mockResolvedValue([]);
    mocks.mirror.markConflict.mockResolvedValue(undefined);
    mocks.mirror.markError.mockResolvedValue(undefined);
    mocks.mirror.hashPage.mockReturnValue("synced");
    mocks.mirror.hashItem.mockReturnValue("synced");
    mocks.mirror.patchFromPage.mockReturnValue({ status: "done" });
    mocks.mirror.upsertItem.mockResolvedValue({
      pageId: "page_test",
      action: "created",
    });
  });

  it("throws when Notion env is absent", async () => {
    mocks.serverEnv.mockReturnValue({});

    await expect(runWorkItemsNotionSyncJob()).rejects.toThrow(
      "Notion work item sync is not configured"
    );
    expect(mocks.NotionWorkItemMirror).not.toHaveBeenCalled();
  });

  it("creates a Notion page for a Dolt item without an existing page", async () => {
    const summary = await runWorkItemsNotionSyncJob({ limit: 25 });

    expect(mocks.getContainer().doltgresWorkItems.list).toHaveBeenCalledWith({
      limit: 25,
    });
    expect(mocks.mirror.upsertItem).toHaveBeenCalledWith(baseItem, {
      syncState: "synced",
      syncError: "",
    });
    expect(summary).toMatchObject({
      scanned: 1,
      created: 1,
      updated: 0,
      appliedPatches: 0,
      conflicts: 0,
      skipped: 0,
      errors: [],
    });
  });

  it("applies a Notion edit through Dolt before projecting the canonical row", async () => {
    const editedPage = page();
    mocks.mirror.listPages.mockResolvedValue([editedPage]);
    mocks.mirror.hashPage.mockReturnValue("edited");
    mocks.mirror.hashItem.mockReturnValue("synced");
    mocks.mirror.upsertItem.mockResolvedValue({
      pageId: "page_test",
      action: "updated",
    });

    const summary = await runWorkItemsNotionSyncJob();

    expect(mocks.getContainer().doltgresWorkItems.patch).toHaveBeenCalledWith(
      { id: baseItem.id, set: { status: "done" } },
      "system:notion-sync"
    );
    expect(mocks.mirror.upsertItem).toHaveBeenCalledWith(patchedItem, {
      pageId: "page_test",
      syncState: "synced",
      syncError: "",
    });
    expect(summary).toMatchObject({
      scanned: 1,
      updated: 1,
      appliedPatches: 1,
      conflicts: 0,
      skipped: 0,
    });
  });

  it("marks concurrent edits as conflicts", async () => {
    const editedPage = page();
    mocks.mirror.listPages.mockResolvedValue([editedPage]);
    mocks.mirror.hashPage.mockReturnValue("edited");
    mocks.mirror.hashItem.mockReturnValue("cogni_changed");

    const summary = await runWorkItemsNotionSyncJob();

    expect(mocks.mirror.markConflict).toHaveBeenCalledWith(
      editedPage,
      "Notion and Cogni both changed since the last sync. Cogni was left unchanged."
    );
    expect(mocks.getContainer().doltgresWorkItems.patch).not.toHaveBeenCalled();
    expect(mocks.mirror.upsertItem).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      scanned: 1,
      conflicts: 1,
      skipped: 1,
    });
  });

  it("marks invalid Notion pages as errors and skips projection", async () => {
    const invalidPage = page({
      validationErrors: ['Invalid Notion Status "In progress".'],
    });
    mocks.mirror.listPages.mockResolvedValue([invalidPage]);

    const summary = await runWorkItemsNotionSyncJob();

    expect(mocks.mirror.markError).toHaveBeenCalledWith(
      invalidPage,
      'Invalid Notion Status "In progress".'
    );
    expect(mocks.mirror.upsertItem).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      scanned: 1,
      skipped: 1,
      errors: [
        {
          id: "task.5067",
          error: 'Invalid Notion Status "In progress".',
        },
      ],
    });
  });
});
