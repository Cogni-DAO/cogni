// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-shared/tests/auth-principal`
 * Purpose: Contract test locking the AuthPrincipal/AuthPolicy/PrincipalType shape.
 * Scope: Type-level conditional asserts + runtime shape checks; does not exercise the wrapper or any resolver.
 * Invariants: actorId non-nullable string; all fields readonly; PrincipalType and AuthPolicy are exact literal unions.
 * Side-effects: none
 * Links: packages/node-shared/src/auth/principal.ts, docs/spec/agent-first-auth.md
 * @internal
 */

import { describe, expect, it } from "vitest";
import type {
  AuthPolicy,
  AuthPrincipal,
  PrincipalType,
} from "../src/auth/principal";

// ──────────────────────────────────────────────────────────────────────────
// Type-level assertions (compile-time enforcement via conditional types)
// ──────────────────────────────────────────────────────────────────────────

type IsExact<A, B> = [A, B] extends [B, A] ? true : false;
type Expect<T extends true> = T;

// ACTOR_IS_PRINCIPAL — actorId is string, not string | null, not optional.
type _ActorIdIsRequired = Expect<IsExact<AuthPrincipal["actorId"], string>>;
type _PrincipalIdIsRequired = Expect<
  IsExact<AuthPrincipal["principalId"], string>
>;
type _TenantIdIsRequired = Expect<IsExact<AuthPrincipal["tenantId"], string>>;
type _PolicyTierIsRequired = Expect<
  IsExact<AuthPrincipal["policyTier"], string>
>;

// userId is explicitly nullable (the only nullable identity field) — this is
// the seam where a human session is distinguished from an unclaimed agent.
type _UserIdIsNullable = Expect<
  IsExact<AuthPrincipal["userId"], string | null>
>;

// LITERAL_PRINCIPAL_TYPE — exact union, no widening.
type _PrincipalTypeIsLiteral = Expect<
  IsExact<PrincipalType, "user" | "agent" | "system">
>;

// LITERAL_AUTH_POLICY — exact union, no widening.
type _AuthPolicyIsLiteral = Expect<
  IsExact<AuthPolicy, "public" | "authenticated" | "session_only" | "admin">
>;

// scopes is a readonly array — downstream code cannot mutate.
type _ScopesIsReadonlyArray = Expect<
  IsExact<AuthPrincipal["scopes"], readonly string[]>
>;

// ──────────────────────────────────────────────────────────────────────────
// Runtime shape assertions (guard against accidental shape drift)
// ──────────────────────────────────────────────────────────────────────────

describe("AuthPrincipal — contract", () => {
  const sampleAgent: AuthPrincipal = {
    principalType: "agent",
    principalId: "00000000-0000-0000-0000-000000000001",
    actorId: "00000000-0000-0000-0000-000000000001",
    userId: null,
    tenantId: "00000000-0000-0000-0000-000000000abc",
    scopes: ["agent"],
    policyTier: "default",
  };

  const sampleUser: AuthPrincipal = {
    principalType: "user",
    principalId: "00000000-0000-0000-0000-000000000002",
    actorId: "00000000-0000-0000-0000-000000000002",
    userId: "00000000-0000-0000-0000-000000000002",
    tenantId: "00000000-0000-0000-0000-000000000abc",
    scopes: ["user"],
    policyTier: "default",
  };

  it("ACTOR_IS_PRINCIPAL — actorId is always present and non-empty for both agents and humans", () => {
    expect(typeof sampleAgent.actorId).toBe("string");
    expect(sampleAgent.actorId.length).toBeGreaterThan(0);
    expect(typeof sampleUser.actorId).toBe("string");
    expect(sampleUser.actorId.length).toBeGreaterThan(0);
  });

  it("userId is null for unclaimed agent principals", () => {
    expect(sampleAgent.userId).toBeNull();
  });

  it("userId equals actorId for the normalized human case (during A1 backfill)", () => {
    expect(sampleUser.userId).toBe(sampleUser.actorId);
  });

  it("principalType is one of the three documented literals", () => {
    const allowed: ReadonlyArray<PrincipalType> = ["user", "agent", "system"];
    expect(allowed).toContain(sampleAgent.principalType);
    expect(allowed).toContain(sampleUser.principalType);
  });

  it("scopes is an array, readonly at the type level, non-empty for v0 principals", () => {
    expect(Array.isArray(sampleAgent.scopes)).toBe(true);
    expect(sampleAgent.scopes.length).toBeGreaterThan(0);
  });

  it("AuthPolicy literal set covers exactly four values — no silent new policies", () => {
    const policies: ReadonlyArray<AuthPolicy> = [
      "public",
      "authenticated",
      "session_only",
      "admin",
    ];
    expect(policies).toHaveLength(4);
    expect(new Set(policies).size).toBe(4);
  });
});
