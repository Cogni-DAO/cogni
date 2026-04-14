// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/auth`
 * Purpose: Barrel export for shared auth types and pure helpers.
 * Scope: Re-exports AuthPrincipal/AuthPolicy (principal.ts), SessionUser (session.ts, deprecated), and linkIntentStore; does not contain runtime side effects.
 * Invariants: Pure re-export, no mutations, no environment access.
 * Side-effects: none
 * Notes: principal.ts is the source of truth; SessionUser stays as a one-release alias until routes migrate.
 * Links: shared/auth/principal, shared/auth/session, docs/spec/agent-first-auth.md
 * @public
 */
export * from "./link-intent-store";
export * from "./principal";
export * from "./session";
