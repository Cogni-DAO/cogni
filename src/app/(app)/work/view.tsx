// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/work/view`
 * Purpose: Client-side work dashboard with sorting, filtering, and search.
 * Scope: Presentation + URL-driven filter state. Does not fetch data or modify server state.
 * Invariants: KIT_IS_ONLY_API, MOBILE_FIRST
 * Side-effects: none
 * Links: [WorkPage](./page.tsx)
 * @public
 */

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import type { WorkItem } from "@/lib/work-scanner";

const STATUS_ORDER: Record<string, number> = {
  needs_merge: 0,
  needs_closeout: 1,
  needs_implement: 2,
  needs_design: 3,
  needs_research: 4,
  needs_triage: 5,
  blocked: 6,
  done: 7,
  cancelled: 8,
};

function priorityPill(pri: number | undefined): string {
  if (pri === 0) {
    return "bg-danger/15 text-danger";
  }
  if (pri === 1) {
    return "bg-primary/15 text-primary-foreground";
  }
  if (pri !== undefined) {
    return "bg-muted text-muted-foreground";
  }
  return "bg-muted text-muted-foreground";
}

/** Soft-tinted pill classes: bg at 15% opacity + matching text color */
const STATUS_PILL: Record<string, string> = {
  needs_merge: "bg-primary/15 text-primary-foreground",
  needs_closeout: "bg-primary/15 text-primary-foreground",
  needs_implement: "bg-warning/15 text-warning",
  needs_design: "bg-warning/15 text-warning",
  needs_research: "bg-warning/15 text-warning",
  needs_triage: "bg-muted text-muted-foreground",
  blocked: "bg-danger/15 text-danger",
  done: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
};

function sortItems(items: WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) => {
    // Priority ascending (undefined last)
    const pa = a.priority ?? 999;
    const pb = b.priority ?? 999;
    if (pa !== pb) {
      return pa - pb;
    }

    // Status order
    const sa = STATUS_ORDER[a.status] ?? 6;
    const sb = STATUS_ORDER[b.status] ?? 6;
    if (sa !== sb) {
      return sa - sb;
    }

    // Updated descending (fallback to created)
    const da = a.updated || a.created || "";
    const db = b.updated || b.created || "";
    return db.localeCompare(da);
  });
}

function getUnique(items: WorkItem[], key: keyof WorkItem): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const val = item[key];
    if (typeof val === "string" && val) {
      set.add(val);
    }
  }
  return [...set].sort();
}

function countByField(
  items: WorkItem[],
  key: keyof WorkItem
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const val = item[key];
    if (typeof val === "string" && val) {
      counts[val] = (counts[val] ?? 0) + 1;
    }
  }
  return counts;
}

export function WorkDashboardView({ items }: { items: WorkItem[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const typeFilter = searchParams.get("type") ?? "";
  const statusFilter = searchParams.get("status") ?? "";
  const maxPri = searchParams.get("maxPri") ?? "";
  const query = searchParams.get("q") ?? "";

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.replace(`/work?${params.toString()}`, { scroll: false });
  };

  const filtered = useMemo(() => {
    let result = items;

    if (typeFilter) {
      result = result.filter((i) => i.type === typeFilter);
    }
    if (statusFilter) {
      result = result.filter((i) => i.status === statusFilter);
    }
    if (maxPri) {
      const n = Number(maxPri);
      if (!Number.isNaN(n)) {
        result = result.filter(
          (i) => i.priority !== undefined && i.priority <= n
        );
      }
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (i) =>
          i.id.toLowerCase().includes(q) ||
          i.title.toLowerCase().includes(q) ||
          i.labels.some((l) => l.toLowerCase().includes(q))
      );
    }

    return sortItems(result);
  }, [items, typeFilter, statusFilter, maxPri, query]);

  const types = getUnique(items, "type");
  const statuses = getUnique(items, "status");
  const statusCounts = countByField(filtered, "status");

  return (
    <div className="mx-auto flex max-w-[var(--max-width-container-screen)] flex-col gap-6 p-4 md:p-8 lg:px-16">
      <div>
        <h1 className="font-semibold text-2xl">Work Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          {filtered.length} of {items.length} items
          {Object.entries(statusCounts).length > 0 && (
            <span className="ml-2">
              (
              {Object.entries(statusCounts)
                .sort(
                  ([a], [b]) => (STATUS_ORDER[a] ?? 6) - (STATUS_ORDER[b] ?? 6)
                )
                .map(([s, c]) => `${s}: ${c}`)
                .join(" / ")}
              )
            </span>
          )}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select
          onValueChange={(v) => setParam("type", v === "all" ? "" : v)}
          value={typeFilter}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          onValueChange={(v) => setParam("status", v === "all" ? "" : v)}
          value={statusFilter}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          onValueChange={(v) => setParam("maxPri", v === "any" ? "" : v)}
          value={maxPri}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Any priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any priority</SelectItem>
            <SelectItem value="0">P0</SelectItem>
            <SelectItem value="1">P0-P1</SelectItem>
            <SelectItem value="2">P0-P2</SelectItem>
            <SelectItem value="3">P0-P3</SelectItem>
          </SelectContent>
        </Select>

        <Input
          className="w-48"
          onChange={(e) => setParam("q", e.target.value)}
          placeholder="Search id, title, labels..."
          value={query}
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Pri</TableHead>
              <TableHead className="w-12">Est</TableHead>
              <TableHead className="w-28">ID</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-28">Updated</TableHead>
              <TableHead>Branch</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  className="py-8 text-center text-muted-foreground"
                  colSpan={7}
                >
                  No work items found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => (
                <TableRow key={item.path}>
                  <TableCell className="text-center">
                    <span
                      className={`inline-flex w-8 justify-center rounded-md px-2 py-1 font-medium text-xs ${priorityPill(item.priority)}`}
                    >
                      {item.priority ?? "\u2014"}
                    </span>
                  </TableCell>
                  <TableCell className="text-center text-xs">
                    {item.estimate ?? "\u2014"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {item.id || "\u2014"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.title || "\u2014"}
                  </TableCell>
                  <TableCell>
                    {item.status ? (
                      <span
                        className={`inline-flex w-24 justify-center rounded-md px-2 py-1 text-center font-medium text-xs ${STATUS_PILL[item.status] ?? "bg-muted text-muted-foreground"}`}
                      >
                        {item.status}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {"\u2014"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {item.updated || item.created || "\u2014"}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground text-xs">
                    {item.branch || "\u2014"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
