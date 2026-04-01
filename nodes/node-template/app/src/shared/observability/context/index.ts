// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/observability/context`
 * Purpose: Public API for request-scoped context.
 * Scope: Re-export RequestContext type and factory. Does not define context lifecycle.
 * Invariants: none
 * Side-effects: none
 * Notes: Import from this module, not from submodules. Cross-cutting observability concern.
 * Links: Delegates to types and factory submodules; used by route handlers.
 * @public
 */

export { createRequestContext } from "./factory";
export type { Clock, RequestContext } from "./types";
