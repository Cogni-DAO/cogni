// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/auth/principal`
 * Purpose: Canonical handler-facing identity carrier for authenticated routes.
 * Scope: Pure domain types (AuthPrincipal, AuthPolicy, PrincipalType); does not contain runtime behavior or I/O.
 * Invariants: actorId is always set (ACTOR_IS_PRINCIPAL); all fields are readonly; PrincipalType and AuthPolicy are exact literal unions.
 * Side-effects: none
 * Notes: During A1, actorId is a runtime cast over users.id in each node's resolveAuthPrincipal; A2 swaps it for an actors-table lookup.
 * Links: docs/spec/agent-first-auth.md, docs/spec/identity-model.md
 * @public
 */

/**
 * Discriminator for the kind of principal behind an authenticated request.
 *
 * - `"user"` — a human session (cookie-authed, or an agent-like credential
 *   whose underlying actor is a human-owned actor row).
 * - `"agent"` — a machine identity (bearer-token-authed, backed by an
 *   `actors` row with `kind='agent'`).
 * - `"system"` — internal system-tenant operations (scheduler, webhook
 *   handlers running under the platform principal).
 */
export type PrincipalType = "user" | "agent" | "system";

/**
 * Route-level authentication policy. Declared as a string literal on
 * `wrapRouteHandlerWithLogging`; the wrapper owns the resolver and returns
 * an `AuthPrincipal` (or enforces a 401/403) accordingly.
 *
 * - `"public"` — no auth; handler receives no principal argument. Still
 *   subject to rate limiting. Used by onboarding endpoints (`agent/register`)
 *   and health endpoints.
 * - `"authenticated"` — default for `/api/v1/*`. Accepts a valid bearer
 *   token OR a same-origin session cookie. 401 otherwise. Handler receives
 *   a non-null `AuthPrincipal`.
 * - `"session_only"` — narrow carve-out. Rejects bearer tokens even if
 *   valid (`BEARER_CLAIMS_EXCLUSIVE`). Used for human-only flows: OAuth
 *   link completion, human profile, governance UI. Handler receives a
 *   `user`-typed principal.
 * - `"admin"` — `"authenticated"` plus a check for the `"admin"` scope.
 *   403 if missing.
 */
export type AuthPolicy = "public" | "authenticated" | "session_only" | "admin";

/**
 * The canonical handler-facing identity carrier.
 *
 * Constructed by the wrapper from whatever proof the request presented
 * (bearer, session cookie, future proof-of-possession). Handlers MUST
 * consume `AuthPrincipal` and MUST NOT inspect how the proof was verified.
 *
 * Field semantics:
 * - `principalType` — discriminator; see `PrincipalType`.
 * - `principalId` — stable, canonical id; equals `actorId` for agents and
 *   for the normalized-human case. Always set.
 * - `actorId` — canonical actor UUID. Always set. Business logic reads
 *   this for authorship / ownership / attribution.
 * - `userId` — set when `principalType === "user"`, or when a user has
 *   claimed an agent actor (post-A5 linkage). `null` for unclaimed agents
 *   and system principals.
 * - `tenantId` — billing / ownership tenant. Always set. Rate limits and
 *   spend caps are attached here (or on the actor row; see A2).
 * - `scopes` — authorization grants. Initial vocabulary is `"user"`,
 *   `"agent"`, `"admin"`. Fine-grained scopes may land later without
 *   changing the type.
 * - `policyTier` — rate / cap bucket label (`"default"` for v0). Business
 *   logic that needs to look up a cap reads this.
 */
export type AuthPrincipal = Readonly<{
  principalType: PrincipalType;
  principalId: string;
  actorId: string;
  userId: string | null;
  tenantId: string;
  scopes: readonly string[];
  policyTier: string;
}>;
