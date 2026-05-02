// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@/ports/work-items-doltgres.port`
 * Purpose: Operator-local port for the Doltgres-backed `work_items` API surface (task.0423 v0).
 * Scope: Type-only port + input shapes derived from `@cogni/work-items` `WorkItemCommandPort`. Concrete adapter lives in `@/adapters/server/db/doltgres/work-items-adapter`.
 * Invariants: Routes/facades depend on this port, NEVER on the concrete adapter. Container wires either the real adapter or a `NotConfigured` impl when DOLTGRES_URL is unset.
 * Side-effects: none
 * Links: docs/spec/work-items-port.md, work/items/task.0423.doltgres-work-items-source-of-truth.md
 * @public
 */

import type {
  WorkItem,
  WorkItemCommandPort,
  WorkItemId,
  WorkQuery,
} from "@cogni/work-items";

export type WorkItemsCreateInput = Parameters<WorkItemCommandPort["create"]>[0];

export type WorkItemsPatchSet = NonNullable<
  Parameters<WorkItemCommandPort["patch"]>[0]["set"]
> & {
  readonly deployVerified?: boolean;
  readonly projectId?: string | null;
  readonly parentId?: string | null;
  readonly blockedBy?: string | null;
};

export interface WorkItemsPatchInput {
  readonly id: WorkItemId;
  readonly set: WorkItemsPatchSet;
}

export interface WorkItemsDoltgresPort {
  get(id: WorkItemId): Promise<WorkItem | null>;
  list(query?: WorkQuery): Promise<{
    items: WorkItem[];
    nextCursor?: string;
    pageInfo: { endCursor: string | null; hasMore: boolean };
  }>;
  create(input: WorkItemsCreateInput, authorTag: string): Promise<WorkItem>;
  patch(
    input: WorkItemsPatchInput,
    authorTag: string
  ): Promise<WorkItem | null>;
}
