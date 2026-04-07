// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/providers-loader.client`
 * Purpose: SSR-safe dynamic loader for wallet providers.
 * Scope: Uses next/dynamic with ssr:false to prevent @walletconnect indexedDB access during static page generation.
 * Invariants: Must remain a "use client" component so next/dynamic ssr:false is allowed.
 * Side-effects: none
 * Links: providers.client.tsx, docs/spec/architecture.md (SSR-unsafe libraries)
 * @public
 */

"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const DynamicProviders = dynamic(
  () => import("./providers.client").then((m) => m.Providers),
  { ssr: false }
);

export function Providers({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return <DynamicProviders>{children}</DynamicProviders>;
}
