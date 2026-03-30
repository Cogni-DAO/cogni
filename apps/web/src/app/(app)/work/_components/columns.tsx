// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

"use client";

import { createColumnHelper } from "@tanstack/react-table";

import type { WorkItemDto } from "@/contracts/work.items.list.v1.contract";

import { StatusPill, TypeIcon } from "./work-item-icons";

const col = createColumnHelper<WorkItemDto>();

export const columns = [
  col.accessor("priority", {
    header: "Pri",
    size: 60,
    cell: (info) => {
      const v = info.getValue();
      if (v == null)
        return <span className="text-muted-foreground">&mdash;</span>;
      return (
        <span className="inline-flex w-7 justify-center rounded-md bg-muted px-1.5 py-0.5 font-medium text-xs">
          P{v}
        </span>
      );
    },
    sortingFn: (a, b) => {
      const pa = a.original.priority ?? 999;
      const pb = b.original.priority ?? 999;
      return pa - pb;
    },
    meta: { headerTitle: "Pri" },
  }),

  col.accessor("type", {
    header: "Type",
    size: 80,
    cell: (info) => (
      <span className="inline-flex items-center gap-1.5">
        <TypeIcon type={info.getValue()} />
        <span className="text-xs capitalize">{info.getValue()}</span>
      </span>
    ),
    filterFn: "arrIncludesSome",
    meta: { headerTitle: "Type" },
  }),

  col.accessor("id", {
    header: "ID",
    size: 110,
    cell: (info) => {
      const id = info.getValue();
      // Show "bug.0002" compact — the slug is in the title
      return (
        <span className="font-mono text-muted-foreground text-xs">{id}</span>
      );
    },
    meta: { headerTitle: "ID" },
  }),

  col.accessor("title", {
    header: "Title",
    minSize: 200,
    cell: (info) => (
      <span className="line-clamp-1 text-sm">{info.getValue()}</span>
    ),
    meta: { headerTitle: "Title" },
  }),

  col.accessor("status", {
    header: "Status",
    size: 150,
    cell: (info) => <StatusPill status={info.getValue()} />,
    filterFn: "arrIncludesSome",
    meta: { headerTitle: "Status" },
  }),

  col.accessor("projectId", {
    header: "Project",
    size: 180,
    cell: (info) => {
      const v = info.getValue();
      if (!v) return <span className="text-muted-foreground">&mdash;</span>;
      return <span className="text-xs">{v.replace("proj.", "")}</span>;
    },
    filterFn: "arrIncludesSome",
    meta: { headerTitle: "Project" },
  }),

  col.accessor("updatedAt", {
    header: "Updated",
    size: 110,
    cell: (info) => {
      const v = info.getValue() || info.row.original.createdAt;
      if (!v) return <span className="text-muted-foreground">&mdash;</span>;
      return (
        <span className="text-muted-foreground text-xs">{v.slice(0, 10)}</span>
      );
    },
    sortingFn: (a, b) => {
      const da = a.original.updatedAt || a.original.createdAt || "";
      const db = b.original.updatedAt || b.original.createdAt || "";
      return da.localeCompare(db);
    },
    meta: { headerTitle: "Updated" },
  }),

  col.accessor("estimate", {
    header: "Est",
    size: 55,
    cell: (info) => {
      const v = info.getValue();
      return (
        <span className="text-center text-muted-foreground text-xs">
          {v ?? "\u2014"}
        </span>
      );
    },
    meta: { headerTitle: "Est" },
  }),
];
