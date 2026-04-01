// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/util`
 * Purpose: Public surface for shared utilities via re-exports.
 * Scope: Re-exports public utility functions. Does not export internal helpers or types.
 * Invariants: No circular dependencies; maintains clean public API.
 * Side-effects: none
 * Notes: Changes here affect module's public API contract; includes UUID validation export.
 * Links: ARCHITECTURE.md#public-surface
 * @public
 */

// NOTE: accountId.ts uses node:crypto and MUST NOT be re-exported here.
// Client components import from this barrel — server-only symbols contaminate the client bundle.
// Import accountId directly: import { deriveAccountIdFromApiKey } from "@/shared/util/accountId"
export { cn } from "./cn";
export { isValidUuid } from "./uuid";
