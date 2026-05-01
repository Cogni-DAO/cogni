// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/work/items.server`
 * Purpose: Server-side facade for work item read/write operations across the markdown + Doltgres surfaces.
 * Scope: Maps port results to contract DTOs. Routes Doltgres-allocated IDs (5000+) to the Doltgres port from `getContainer()`; legacy markdown IDs to the markdown port.
 * Invariants: PORT_VIA_CONTAINER (no direct adapter imports), CONTRACTS_ARE_TRUTH, ID_RANGE_RESERVED.
 * Side-effects: IO (filesystem read via port; database read/write via Doltgres port)
 * Links: contracts/work.items.{list,get,create,patch}.v1.contract, work/items/task.0423.doltgres-work-items-source-of-truth.md
 * @internal
 */

import type {
  WorkItemsCreateInput as ContractCreateInput,
  WorkItemsPatchInput as ContractPatchInput,
  WorkItemDto,
  WorkItemsListInput,
  WorkItemsListOutput,
} from "@cogni/node-contracts";
import type { WorkItem, WorkItemId } from "@cogni/work-items";
import { toWorkItemId } from "@cogni/work-items";

import { InvalidCursorError } from "@/adapters/server/db/doltgres/work-items-cursor";
import { getContainer } from "@/bootstrap/container";

export { InvalidCursorError };

export class WorkItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Work item not found: ${id}`);
    this.name = "WorkItemNotFoundError";
  }
}

export class WorkItemsBackendNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkItemsBackendNotReadyError";
  }
}

function toDto(item: WorkItem): WorkItemDto {
  return {
    id: item.id as string,
    type: item.type,
    title: item.title,
    status: item.status,
    ...(item.actor !== "either" && { actor: item.actor }),
    priority: item.priority,
    rank: item.rank,
    estimate: item.estimate,
    summary: item.summary,
    outcome: item.outcome,
    projectId: item.projectId as string | undefined,
    parentId: item.parentId as string | undefined,
    node: item.node,
    assignees: item.assignees as WorkItemDto["assignees"],
    externalRefs: item.externalRefs as WorkItemDto["externalRefs"],
    labels: item.labels as string[],
    specRefs: item.specRefs as string[],
    branch: item.branch,
    pr: item.pr,
    reviewer: item.reviewer,
    revision: item.revision,
    blockedBy: item.blockedBy as string | undefined,
    deployVerified: item.deployVerified,
    claimedByRun: item.claimedByRun,
    claimedAt: item.claimedAt,
    lastCommand: item.lastCommand,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function isDoltgresId(id: string): boolean {
  const dot = id.lastIndexOf(".");
  if (dot < 0) return false;
  const tail = id.slice(dot + 1);
  if (!/^\d+$/.test(tail)) return false;
  return Number.parseInt(tail, 10) >= 5000;
}

function authorTagFromSession(user: {
  id: string;
  displayName: string | null;
}): string {
  const handle = user.displayName?.trim() || user.id;
  return `actor:${handle}`;
}

type StripUndefined<T> = {
  [K in keyof T]?: Exclude<T[K], undefined>;
};

function dropUndefined<T extends Record<string, unknown>>(
  obj: T
): StripUndefined<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as StripUndefined<T>;
}

export async function listWorkItems(
  input: WorkItemsListInput
): Promise<WorkItemsListOutput> {
  const container = getContainer();
  const queryShared = {
    ...(input.types && { types: input.types as WorkItem["type"][] }),
    ...(input.statuses && { statuses: input.statuses as WorkItem["status"][] }),
    ...(input.text && { text: input.text }),
    ...(input.actor && { actor: input.actor as WorkItem["actor"] }),
    ...(input.projectId && { projectId: toWorkItemId(input.projectId) }),
    ...(input.node && { node: input.node }),
    ...(input.limit && { limit: input.limit }),
    ...(input.cursor && { cursor: input.cursor }),
  };

  // Pagination strategy:
  //   - Doltgres is the cursor-paginated source of truth (post-#1144 importer
  //     back-fills markdown items into Doltgres at their original IDs).
  //   - On the first page (no cursor) we ALSO query the markdown adapter so
  //     any items that haven't been imported yet still appear. Doltgres rows
  //     win on id conflict (single-source dedup).
  //   - Merged page is truncated to `limit` so the response never overflows.
  //   - hasMore tracks Doltgres only — markdown is finite/small and only
  //     contributes to page 1; once Doltgres exhausts pagination ends.
  //   - Markdown-only items that overflow page 1 are dropped from the response;
  //     this is acceptable because markdown is being deprecated and the
  //     importer back-fill closes the gap.
  let dgItems: WorkItem[] = [];
  let endCursor: string | null = null;
  let hasMore = false;

  try {
    const dgResult = await container.doltgresWorkItems.list(queryShared);
    dgItems = [...dgResult.items];
    endCursor = dgResult.pageInfo.endCursor;
    hasMore = dgResult.pageInfo.hasMore;
  } catch (e) {
    if ((e as Error)?.name !== "DoltgresNotConfiguredError") throw e;
  }

  let merged: WorkItem[] = dgItems;
  if (!input.cursor) {
    const mdResult = await container.workItemQuery.list(queryShared);
    const dgIds = new Set(dgItems.map((i) => i.id as string));
    const mdOnly = mdResult.items.filter((i) => !dgIds.has(i.id as string));
    merged = [...dgItems, ...mdOnly];
  }

  const requestedLimit = input.limit ?? 100;
  if (merged.length > requestedLimit) {
    merged = merged.slice(0, requestedLimit);
  }

  return {
    items: merged.map(toDto),
    pageInfo: { endCursor, hasMore },
    ...(endCursor !== null && { nextCursor: endCursor }),
  };
}

export async function getWorkItem(id: string): Promise<WorkItemDto | null> {
  const container = getContainer();
  if (isDoltgresId(id)) {
    try {
      const item = await container.doltgresWorkItems.get(toWorkItemId(id));
      return item ? toDto(item) : null;
    } catch (e) {
      if ((e as Error)?.name === "DoltgresNotConfiguredError") return null;
      throw e;
    }
  }
  const item = await container.workItemQuery.get(id as WorkItemId);
  return item ? toDto(item) : null;
}

export async function createWorkItem(
  input: ContractCreateInput,
  sessionUser: { id: string; displayName: string | null }
): Promise<WorkItemDto> {
  const container = getContainer();
  try {
    const created = await container.doltgresWorkItems.create(
      {
        type: input.type,
        title: input.title,
        ...(input.summary !== undefined && { summary: input.summary }),
        ...(input.outcome !== undefined && { outcome: input.outcome }),
        ...(input.specRefs !== undefined && { specRefs: input.specRefs }),
        ...(input.projectId !== undefined && {
          projectId: toWorkItemId(input.projectId),
        }),
        ...(input.parentId !== undefined && {
          parentId: toWorkItemId(input.parentId),
        }),
        ...(input.labels !== undefined && { labels: input.labels }),
        ...(input.assignees !== undefined && { assignees: input.assignees }),
        ...(input.node !== undefined && { node: input.node }),
      },
      authorTagFromSession(sessionUser)
    );
    return toDto(created);
  } catch (e) {
    if ((e as Error)?.name === "DoltgresNotConfiguredError") {
      throw new WorkItemsBackendNotReadyError((e as Error).message);
    }
    throw e;
  }
}

export async function patchWorkItem(
  input: ContractPatchInput,
  sessionUser: { id: string; displayName: string | null }
): Promise<WorkItemDto> {
  if (!isDoltgresId(input.id)) {
    throw new WorkItemNotFoundError(input.id);
  }
  const container = getContainer();
  try {
    const patched = await container.doltgresWorkItems.patch(
      {
        id: toWorkItemId(input.id),
        set: dropUndefined(input.set),
      },
      authorTagFromSession(sessionUser)
    );
    if (!patched) throw new WorkItemNotFoundError(input.id);
    return toDto(patched);
  } catch (e) {
    if ((e as Error)?.name === "DoltgresNotConfiguredError") {
      throw new WorkItemsBackendNotReadyError((e as Error).message);
    }
    throw e;
  }
}
