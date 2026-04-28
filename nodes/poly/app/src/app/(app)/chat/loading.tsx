// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/chat/loading`
 * Purpose: Per-route Suspense fallback for `/chat`. Overrides the default
 *   `(app)/loading.tsx` because `/chat` has its own layout (`chat-viewport
 *   flex overflow-hidden`) that is NOT a `PageContainer` — the default
 *   skeleton renders inside the wrong shell and the user sees a visible
 *   layout-class jump on RSC arrival.
 * Scope: Server component, layout-preserving inside `chat/layout.tsx`.
 * Invariants: Matches the chat-viewport flex shell — full-height,
 *   overflow-hidden, optional thread-list rail on lg+, message column,
 *   composer pinned to bottom.
 * Side-effects: none
 * Links: ./layout.tsx, ./view.tsx, src/components/vendor/shadcn/skeleton.tsx
 * @public
 */

import { Skeleton } from "@/components";

export default function ChatLoading() {
  return (
    <div className="flex h-full w-full">
      {/* Thread-list rail — visible only on lg+, mirrors the actual chat layout */}
      <div className="hidden w-72 shrink-0 border-r p-3 lg:flex lg:flex-col lg:gap-2">
        <Skeleton className="h-9 w-full" />
        <div className="flex flex-col gap-1.5 pt-2">
          {Array.from({ length: 6 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton thread rows are static
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>

      {/* Main column: messages + composer */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Messages — alternating left/right bubbles */}
        <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
          <Skeleton className="h-16 w-3/4 max-w-2xl rounded-lg" />
          <Skeleton className="ml-auto h-12 w-2/3 max-w-xl rounded-lg" />
          <Skeleton className="h-20 w-3/4 max-w-2xl rounded-lg" />
          <Skeleton className="ml-auto h-12 w-1/2 max-w-xl rounded-lg" />
        </div>

        {/* Composer — pinned to bottom */}
        <div className="border-t p-3">
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
