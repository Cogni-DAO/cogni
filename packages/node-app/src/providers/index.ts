// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-app/providers`
 * Purpose: Barrel re-exports for platform providers.
 * Scope: Re-exports only. Does not contain logic or side effects.
 * Invariants: Curated exports — internal files are not importable.
 * Side-effects: none
 * Links: packages/node-app/src/providers/auth-provider.tsx, packages/node-app/src/providers/query-provider.tsx
 * @public
 */

export { AuthProvider } from "./auth-provider";
export { QueryProvider } from "./query-provider";
export { createAppDarkTheme, createAppLightTheme } from "./rainbowkit-theme";
