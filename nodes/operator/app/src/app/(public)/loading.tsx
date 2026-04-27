// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(public)/loading`
 * Purpose: Default Suspense fallback for every route under the `(public)`
 *   route group (landing, propose/merge, etc). Renders an instant
 *   skeleton while the RSC payload streams in.
 * Scope: Server component, layout-preserving.
 * Invariants: Renders inside `(public)/layout.tsx`. Uses `PageSkeleton`
 *   from `kit/layout` so the app layer stays free of direct vendor
 *   shadcn imports (UI governance rule).
 * Side-effects: none
 * Links: ./layout.tsx, src/components/kit/layout/PageSkeleton.tsx,
 *   https://nextjs.org/docs/app/building-your-application/routing/loading-ui-and-streaming
 * @public
 */

import { PageSkeleton } from "@/components/kit/layout/PageSkeleton";

export default function PublicLoading() {
  return <PageSkeleton maxWidth="2xl" />;
}
