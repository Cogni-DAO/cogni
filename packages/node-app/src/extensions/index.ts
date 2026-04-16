// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-app/extensions`
 * Purpose: Barrel re-exports for extension-point types and context provider.
 * Scope: Re-exports only. Does not contain logic or side effects.
 * Invariants: Curated exports — internal files are not importable.
 * Side-effects: none
 * Links: packages/node-app/src/extensions/types.ts, packages/node-app/src/extensions/context.tsx
 * @public
 */

export { NodeAppProvider, useNodeAppConfig } from "./context";
export type { ExternalLink, NavItem, NodeAppConfig } from "./types";
