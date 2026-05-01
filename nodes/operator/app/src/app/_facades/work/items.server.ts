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

import { getContainer } from "@/bootstrap/container";

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

  // Cursor-paginate Doltgres only — markdown rows are appended once on the
  // first page (no cursor provided). Markdown is being deprecated; once the
  // importer back-fill is complete it returns ~0 rows in practice.
  const merged: WorkItem[] = [];
  let endCursor: string | null = null;
  let hasMore = false;

  if (!input.cursor) {
    const mdResult = await container.workItemQuery.list(queryShared);
    merged.push(...mdResult.items);
  }

  try {
    const dgResult = await container.doltgresWorkItems.list(queryShared);
    merged.push(...dgResult.items);
    endCursor = dgResult.pageInfo.endCursor;
    hasMore = dgResult.pageInfo.hasMore;
  } catch (e) {
    if ((e as Error)?.name !== "DoltgresNotConfiguredError") throw e;
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
