// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/work/view`
 * Purpose: Client-side work dashboard with sorting, filtering, and search.
 * Scope: Presentation + URL-driven filter state. Fetches data via React Query.
 * Invariants: KIT_IS_ONLY_API, MOBILE_FIRST, CONTRACTS_ARE_TRUTH
 * Side-effects: IO (fetches from /api/v1/work/items)
 * Links: [WorkPage](./page.tsx), [fetchWorkItems](./_api/fetchWorkItems.ts)
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
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
import type { WorkItemDto } from "@/contracts/work.items.list.v1.contract";

import { fetchWorkItems } from "./_api/fetchWorkItems";

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
  if (pri === 0) return "bg-danger/15 text-danger";
  if (pri === 1) return "bg-primary/15 text-primary-foreground";
  if (pri !== undefined) return "bg-muted text-muted-foreground";
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

function sortItems(items: WorkItemDto[]): WorkItemDto[] {
  return [...items].sort((a, b) => {
    // Priority ascending (undefined last)
    const pa = a.priority ?? 999;
    const pb = b.priority ?? 999;
    if (pa !== pb) return pa - pb;

    // Status order
    const sa = STATUS_ORDER[a.status] ?? 6;
    const sb = STATUS_ORDER[b.status] ?? 6;
    if (sa !== sb) return sa - sb;

    // Updated descending (fallback to created)
    const da = a.updatedAt || a.createdAt || "";
    const db = b.updatedAt || b.createdAt || "";
    return db.localeCompare(da);
  });
}

function getUnique(items: WorkItemDto[], key: keyof WorkItemDto): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const val = item[key];
    if (typeof val === "string" && val) set.add(val);
  }
  return [...set].sort();
}

export function WorkDashboardView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["work-items"],
    queryFn: fetchWorkItems,
    staleTime: 30_000,
  });

  const items = data?.items ?? [];

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

  return (
    <div className="flex flex-col gap-6 p-5 md:p-6">
      <h1 className="font-semibold text-xl tracking-tight md:text-2xl">
        Work Dashboard
      </h1>

      {/* Filters */}
      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-3">
        <Select
          value={typeFilter}
          onValueChange={(v) => setParam("type", v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-full sm:w-36">
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
          value={statusFilter}
          onValueChange={(v) => setParam("status", v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-full sm:w-40">
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
          value={maxPri}
          onValueChange={(v) => setParam("maxPri", v === "any" ? "" : v)}
        >
          <SelectTrigger className="w-full sm:w-36">
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
          className="col-span-3 sm:w-48"
          placeholder="Search id, title, labels..."
          value={query}
          onChange={(e) => setParam("q", e.target.value)}
        />
      </div>

      {/* Loading / Error states */}
      {isLoading && (
        <p className="py-8 text-center text-muted-foreground">
          Loading work items...
        </p>
      )}
      {error && (
        <p className="py-8 text-center text-danger">
          Failed to load work items.
        </p>
      )}

      {/* Table — edge-to-edge on mobile, rounded on md+ */}
      {!isLoading && !error && (
        <div className="-mx-5 overflow-x-auto border-t border-b md:mx-0 md:rounded-md md:border">
          <Table className="min-w-[var(--min-width-table-scroll)]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 md:w-14">Pri</TableHead>
                <TableHead className="w-10">Est</TableHead>
                <TableHead className="w-44 md:w-72">ID</TableHead>
                <TableHead className="w-24 md:w-28">Status</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-24">Updated</TableHead>
                <TableHead>Branch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No work items found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-center text-xs">
                      <span
                        className={`inline-flex w-8 justify-center rounded-md px-2 py-0.5 font-medium ${priorityPill(item.priority)}`}
                      >
                        {item.priority ?? "\u2014"}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      {item.estimate ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.id || "\u2014"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.status ? (
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 font-medium text-xs ${STATUS_PILL[item.status] ?? "bg-muted text-muted-foreground"}`}
                        >
                          {item.status}
                        </span>
                      ) : (
                        "\u2014"
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.title || "\u2014"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.updatedAt || item.createdAt || "\u2014"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.branch || "\u2014"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
