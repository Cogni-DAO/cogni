// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/auth/link-intent-store`
 * Purpose: AsyncLocalStorage for passing link intent from route handler to NextAuth signIn callback.
 * Scope: Shared primitive. Only imports node:async_hooks. Does not depend on framework, IO, or route modules.
 * Invariants: Request-scoped via AsyncLocalStorage. Requires Node.js runtime (not Edge).
 * Side-effects: none
 * Links: docs/spec/authentication.md
 * @public
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface LinkIntent {
  userId: string;
}

export const linkIntentStore = new AsyncLocalStorage<LinkIntent | null>();
