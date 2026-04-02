// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/work/view`
 * Purpose: Client-side work dashboard with TanStack Table (ReUI data-grid), sorting, faceted filtering, detail panel.
 * Scope: Presentation + URL-driven filter state. Fetches data via React Query.
 * Invariants: KIT_IS_ONLY_API, MOBILE_FIRST, CONTRACTS_ARE_TRUTH, URL_DRIVEN_STATE
 * Side-effects: IO (fetches from /api/v1/work/items)
 * Links: [WorkPage](./page.tsx), [fetchWorkItems](./_api/fetchWorkItems.ts)
 * @public
 */

"use client";

import type { WorkItemDto } from "@cogni/node-contracts";
import { useQuery } from "@tanstack/react-query";
import {
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components";
import {
  DataGrid,
  DataGridContainer,
} from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";

import { fetchWorkItems } from "./_api/fetchWorkItems";
import { columns } from "./_components/columns";
import { FacetedFilter } from "./_components/FacetedFilter";
import { WorkItemDetail } from "./_components/WorkItemDetail";

function getUniqueValues(
  items: WorkItemDto[],
  key: keyof WorkItemDto
): string[] {
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

  // --- URL-driven state ---
  // Default: hide done/cancelled unless user explicitly sets status filter
  const ACTIVE_STATUSES = [
    "needs_triage",
    "needs_research",
    "needs_design",
    "needs_implement",
    "needs_closeout",
    "needs_merge",
    "blocked",
  ];

  const initialFilters = useMemo((): ColumnFiltersState => {
    const filters: ColumnFiltersState = [];
    const typeParam = searchParams.get("type");
    if (typeParam) filters.push({ id: "type", value: typeParam.split(",") });
    const statusParam = searchParams.get("status");
    if (statusParam) {
      filters.push({ id: "status", value: statusParam.split(",") });
    } else {
      // Default: active items only
      filters.push({ id: "status", value: ACTIVE_STATUSES });
    }
    const projectParam = searchParams.get("project");
    if (projectParam)
      filters.push({ id: "projectId", value: projectParam.split(",") });
    return filters;
  }, [searchParams]);

  const initialSorting = useMemo((): SortingState => {
    const sortParam = searchParams.get("sort");
    if (sortParam) {
      const desc = sortParam.startsWith("-");
      const id = desc ? sortParam.slice(1) : sortParam;
      return [{ id, desc }];
    }
    return [{ id: "priority", desc: false }];
  }, [searchParams]);

  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] =
    useState<ColumnFiltersState>(initialFilters);
  const [globalFilter, setGlobalFilter] = useState(searchParams.get("q") ?? "");

  // Sync state → URL
  const syncUrl = useCallback(
    (
      newFilters: ColumnFiltersState,
      newSorting: SortingState,
      newQuery: string
    ) => {
      const params = new URLSearchParams();
      for (const f of newFilters) {
        const key = f.id === "projectId" ? "project" : f.id;
        if (Array.isArray(f.value) && f.value.length > 0) {
          params.set(key, (f.value as string[]).join(","));
        }
      }
      if (newSorting.length > 0 && newSorting[0]) {
        const s = newSorting[0];
        params.set("sort", s.desc ? `-${s.id}` : s.id);
      }
      if (newQuery) params.set("q", newQuery);
      const qs = params.toString();
      router.replace(qs ? `/work?${qs}` : "/work", { scroll: false });
    },
    [router]
  );

  // --- Detail panel ---
  const [selectedItem, setSelectedItem] = useState<WorkItemDto | null>(null);

  // --- Table ---
  const table = useReactTable({
    data: items,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      setSorting(next);
      syncUrl(columnFilters, next, globalFilter);
    },
    onColumnFiltersChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnFilters) : updater;
      setColumnFilters(next);
      syncUrl(next, sorting, globalFilter);
    },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: (row, _columnId, filterValue: string) => {
      const q = filterValue.toLowerCase();
      const d = row.original;
      return (
        d.id.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q) ||
        d.labels.some((l: string) => l.toLowerCase().includes(q))
      );
    },
  });

  const rows = table.getRowModel().rows;

  // Keyboard handler
  const [focusedRowIndex, setFocusedRowIndex] = useState(-1);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (rows.length === 0) return;

      switch (e.key) {
        case "j":
          e.preventDefault();
          setFocusedRowIndex((prev) => Math.min(prev + 1, rows.length - 1));
          break;
        case "k":
          e.preventDefault();
          setFocusedRowIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          if (focusedRowIndex >= 0 && focusedRowIndex < rows.length) {
            const row = rows[focusedRowIndex];
            if (row) {
              e.preventDefault();
              setSelectedItem(row.original);
            }
          }
          break;
        case "/":
          e.preventDefault();
          document
            .querySelector<HTMLInputElement>("[data-search-input]")
            ?.focus();
          break;
        case "Escape":
          if (selectedItem) {
            setSelectedItem(null);
          }
          break;
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [rows, focusedRowIndex, selectedItem]);

  // Facet options
  const typeOptions = getUniqueValues(items, "type");
  const statusOptions = getUniqueValues(items, "status");
  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.projectId) set.add(item.projectId);
    }
    return [...set].sort();
  }, [items]);

  const activeTypeFilter =
    (columnFilters.find((f) => f.id === "type")?.value as string[]) ?? [];
  const activeStatusFilter =
    (columnFilters.find((f) => f.id === "status")?.value as string[]) ?? [];
  const activeProjectFilter =
    (columnFilters.find((f) => f.id === "projectId")?.value as string[]) ?? [];

  function setFacet(id: string, values: string[]) {
    const next = columnFilters.filter((f) => f.id !== id);
    if (values.length > 0) next.push({ id, value: values });
    setColumnFilters(next);
    syncUrl(next, sorting, globalFilter);
  }

  return (
    <div className="flex flex-col gap-4 p-5 md:p-6">
      <h1 className="font-semibold text-xl tracking-tight md:text-2xl">
        Work Dashboard
      </h1>

      {/* Toolbar: Search + Faceted Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          data-search-input
          className="h-9 w-full sm:w-56"
          placeholder="Search id, title, labels... ( / )"
          value={globalFilter}
          onChange={(e) => {
            setGlobalFilter(e.target.value);
            syncUrl(columnFilters, sorting, e.target.value);
          }}
        />
        <FacetedFilter
          title="Type"
          options={typeOptions}
          selected={activeTypeFilter}
          onChange={(v) => setFacet("type", v)}
        />
        <FacetedFilter
          title="Status"
          options={statusOptions}
          selected={activeStatusFilter}
          onChange={(v) => setFacet("status", v)}
        />
        <FacetedFilter
          title="Project"
          options={projectOptions}
          selected={activeProjectFilter}
          onChange={(v) => setFacet("projectId", v)}
        />
        {columnFilters.length > 0 && (
          <button
            type="button"
            className="text-muted-foreground text-xs underline hover:text-foreground"
            onClick={() => {
              setColumnFilters([]);
              syncUrl([], sorting, globalFilter);
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Loading / Error */}
      {isLoading && (
        <p className="py-8 text-center text-muted-foreground">
          Loading work items...
        </p>
      )}
      {error && (
        <p className="py-8 text-center text-destructive">
          Failed to load work items.
        </p>
      )}

      {/* Data Grid */}
      {!isLoading && !error && (
        <DataGrid
          table={table}
          recordCount={items.length}
          isLoading={isLoading}
          onRowClick={(row) => setSelectedItem(row)}
          tableLayout={{
            headerSticky: true,
            headerBackground: true,
            rowBorder: true,
            dense: true,
          }}
          tableClassNames={{
            bodyRow: "cursor-pointer",
          }}
          emptyMessage="No work items found."
        >
          <DataGridContainer className="overflow-x-auto">
            <DataGridTable />
          </DataGridContainer>
          <DataGridPagination sizes={[25, 50, 100]} />
        </DataGrid>
      )}

      {/* Detail Panel */}
      <WorkItemDetail
        item={selectedItem}
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
      />
    </div>
  );
}
