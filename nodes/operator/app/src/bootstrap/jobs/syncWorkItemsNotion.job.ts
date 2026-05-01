// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/syncWorkItemsNotion`
 * Purpose: Prototype sync job between Dolt-backed Cogni work items and a Notion data source.
 * Scope: Operator-only orchestration. Dolt remains source of truth; Notion is a human view/edit port.
 * Invariants:
 * - DOLT_IS_SOURCE_OF_TRUTH: Notion never allocates work item IDs.
 * - EXACT_ID_MIRROR: Notion pages are keyed by exact Cogni IDs.
 * - CONFLICTS_VISIBLE: Concurrent edits are marked on the Notion page instead of being silently overwritten.
 * Side-effects: IO (Doltgres work item port, Notion API)
 * Links: docs/spec/work-items-port.md
 * @internal
 */

import type { WorkItem } from "@cogni/work-items";
import {
  NotionWorkItemMirror,
  type NotionWorkItemPage,
  type WorkItemNotionPatch,
} from "@cogni/work-items/notion";

import { getContainer } from "@/bootstrap/container";
import { serverEnv } from "@/shared/env/server-env";

export interface WorkItemsNotionSyncSummary {
  scanned: number;
  created: number;
  updated: number;
  appliedPatches: number;
  conflicts: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}

export interface WorkItemsNotionSyncOptions {
  limit?: number;
}

function patchSize(patch: WorkItemNotionPatch): number {
  return Object.keys(patch).length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configuredMirror(): NotionWorkItemMirror {
  const env = serverEnv();
  if (!env.WORK_ITEMS_NOTION_TOKEN || !env.WORK_ITEMS_NOTION_DATA_SOURCE_ID) {
    throw new Error(
      "Notion work item sync is not configured. Set WORK_ITEMS_NOTION_TOKEN and WORK_ITEMS_NOTION_DATA_SOURCE_ID."
    );
  }

  return new NotionWorkItemMirror({
    authToken: env.WORK_ITEMS_NOTION_TOKEN,
    dataSourceId: env.WORK_ITEMS_NOTION_DATA_SOURCE_ID,
    ...(env.WORK_ITEMS_NOTION_VERSION && {
      notionVersion: env.WORK_ITEMS_NOTION_VERSION,
    }),
  });
}

async function indexNotionPages(
  mirror: NotionWorkItemMirror,
  notionPages: NotionWorkItemPage[],
  summary: WorkItemsNotionSyncSummary
): Promise<Map<string, NotionWorkItemPage>> {
  const pagesById = new Map<string, NotionWorkItemPage>();
  for (const page of notionPages) {
    if (!page.cogniId) continue;
    const id = String(page.cogniId);
    const existing = pagesById.get(id);
    if (existing) {
      await mirror.markError(page, `Duplicate Notion page for Cogni ID ${id}`);
      summary.errors.push({ id, error: "duplicate_notion_page" });
      continue;
    }
    pagesById.set(id, page);
  }
  return pagesById;
}

function hasConcurrentEdit(
  mirror: NotionWorkItemMirror,
  page: NotionWorkItemPage,
  item: WorkItem
): boolean {
  if (!page.syncHash) return false;
  const notionHash = mirror.hashPage(page);
  const cogniHash = mirror.hashItem(item);
  return notionHash !== page.syncHash && cogniHash !== page.syncHash;
}

async function applyNotionPatch(
  mirror: NotionWorkItemMirror,
  page: NotionWorkItemPage | undefined,
  item: WorkItem,
  summary: WorkItemsNotionSyncSummary
): Promise<WorkItem> {
  if (!page?.syncHash || mirror.hashPage(page) === page.syncHash) return item;

  const container = getContainer();
  const patch = mirror.patchFromPage(page, item);
  if (patchSize(patch) === 0) return item;

  const patched = await container.doltgresWorkItems.patch(
    {
      id: item.id,
      set: patch,
    },
    "system:notion-sync"
  );
  if (!patched) return item;

  summary.appliedPatches += 1;
  return patched;
}

async function syncOneItem(
  mirror: NotionWorkItemMirror,
  item: WorkItem,
  page: NotionWorkItemPage | undefined,
  summary: WorkItemsNotionSyncSummary
): Promise<void> {
  if (page?.validationErrors.length) {
    const error = page.validationErrors.join(" ");
    await mirror.markError(page, error);
    summary.errors.push({ id: String(item.id), error });
    summary.skipped += 1;
    return;
  }

  if (page && hasConcurrentEdit(mirror, page, item)) {
    await mirror.markConflict(
      page,
      "Notion and Cogni both changed since the last sync. Cogni was left unchanged."
    );
    summary.conflicts += 1;
    summary.skipped += 1;
    return;
  }

  const canonical = await applyNotionPatch(mirror, page, item, summary);
  const upsert = await mirror.upsertItem(canonical, {
    ...(page?.pageId ? { pageId: page.pageId } : {}),
    syncState: "synced",
    syncError: "",
  });
  if (upsert.action === "created") summary.created += 1;
  if (upsert.action === "updated") summary.updated += 1;
}

export async function runWorkItemsNotionSyncJob(
  options: WorkItemsNotionSyncOptions = {}
): Promise<WorkItemsNotionSyncSummary> {
  const container = getContainer();
  const mirror = configuredMirror();
  const limit = Math.min(options.limit ?? 500, 500);

  const summary: WorkItemsNotionSyncSummary = {
    scanned: 0,
    created: 0,
    updated: 0,
    appliedPatches: 0,
    conflicts: 0,
    skipped: 0,
    errors: [],
  };

  const [source, notionPages] = await Promise.all([
    container.doltgresWorkItems.list({ limit }),
    mirror.listPages(),
  ]);

  const pagesById = await indexNotionPages(mirror, notionPages, summary);

  for (const initialItem of source.items) {
    const id = String(initialItem.id);
    summary.scanned += 1;

    try {
      await syncOneItem(mirror, initialItem, pagesById.get(id), summary);
    } catch (error) {
      summary.errors.push({ id, error: errorMessage(error) });
    }
  }

  return summary;
}
