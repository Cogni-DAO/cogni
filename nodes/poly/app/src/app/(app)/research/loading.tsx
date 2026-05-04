// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/loading`
 * Purpose: Per-route Suspense fallback for `/research`. Mirrors the
 *   research portal — benchmark cards first, then wallet discovery controls,
 *   WalletsTable, and no-fly footer aside.
 * Scope: Server component, layout-preserving inside `(app)/layout.tsx`.
 * Invariants: Outer container matches `view.tsx` (`flex flex-col gap-4
 *   p-5 md:p-6`). Research panels are dominant; discovery table sits below.
 * Side-effects: none
 * Links: ./view.tsx, src/components/kit/layout/TableSkeleton.tsx
 * @public
 */

import { Skeleton } from "@/components";
import { PageHeaderSkeleton } from "@/components/kit/layout/PageHeaderSkeleton";
import { TableSkeleton } from "@/components/kit/layout/TableSkeleton";

export default function ResearchLoading() {
  return (
    <div className="flex flex-col gap-6 p-5 md:p-6">
      <PageHeaderSkeleton
        titleWidth="w-32"
        withSubtitle
        subtitleWidth="w-1/2"
      />

      {/* Primary benchmark cards */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-96 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
      <Skeleton className="h-80 w-full rounded-lg" />

      <section className="flex flex-col gap-4 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-6 w-52" />
          </div>
          <Skeleton className="h-10 w-full max-w-xl sm:w-96" />
        </div>

        {/* Toolbar: search input + period toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-full sm:w-72" />
          <Skeleton className="h-9 w-48" />
        </div>

        <TableSkeleton rows={10} />
      </section>

      {/* No-fly footer aside — 2-col on md+ */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}
