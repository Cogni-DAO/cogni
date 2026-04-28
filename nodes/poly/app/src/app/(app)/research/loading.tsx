// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/loading`
 * Purpose: Per-route Suspense fallback for `/research`. Mirrors the
 *   wallets-research portal — title + subtitle + WalletQuickJump bar +
 *   search/period toolbar + WalletsTable + no-fly footer aside.
 * Scope: Server component, layout-preserving inside `(app)/layout.tsx`.
 * Invariants: Outer container matches `view.tsx` (`flex flex-col gap-4
 *   p-5 md:p-6`). Table dominant; footer aside is 2-col on md+.
 * Side-effects: none
 * Links: ./view.tsx, src/components/kit/layout/TableSkeleton.tsx
 * @public
 */

import { Skeleton } from "@/components";
import { PageHeaderSkeleton } from "@/components/kit/layout/PageHeaderSkeleton";
import { TableSkeleton } from "@/components/kit/layout/TableSkeleton";

export default function ResearchLoading() {
  return (
    <div className="flex flex-col gap-4 p-5 md:p-6">
      <PageHeaderSkeleton
        titleWidth="w-56"
        withSubtitle
        subtitleWidth="w-2/3"
      />

      {/* WalletQuickJump — paste-an-address affordance */}
      <Skeleton className="h-10 w-full max-w-xl" />

      {/* Toolbar: search input + period toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full sm:w-72" />
        <Skeleton className="h-9 w-48" />
      </div>

      {/* The dominant element — wallets table */}
      <TableSkeleton rows={10} />

      {/* No-fly footer aside — 2-col on md+ */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}
