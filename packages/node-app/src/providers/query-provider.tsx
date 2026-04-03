// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-app/providers`
 * Purpose: React Query provider for client-side data fetching and caching.
 * Scope: Wraps application with QueryClientProvider; configures default options. Does not fetch data or manage state directly.
 * Invariants: QueryClient instance created once per component mount; stale time 60 seconds.
 * Side-effects: none
 * Links: https://tanstack.com/query/latest/docs/framework/react/overview
 * @public
 */

"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

export function QueryProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
