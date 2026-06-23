// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/vcs/authorize-node-action`
 * Purpose: One authorization path for node-scoped VCS actions (flight, merge). Checks the
 *   billing account first (billing-before-authz, mirroring flight), then the OpenFGA capability.
 * Scope: Shared by `vcs/flight` and `vcs/merge` so the load-bearing billing→authz ordering can
 *   never drift between the two routes.
 * Invariants:
 *   - BILLING_BEFORE_AUTHZ: a principal with no billing account 403s `billing_account_missing`
 *     before the OpenFGA check (the gated VCS routes resolve a billing tenant in `context`).
 *   - FAIL_CLOSED_WITH_DISTINCTION: infra failure ⇒ `authz_unavailable` (503), distinct from
 *     `authz_denied` (403).
 *   - V0_OWNER_FALLBACK: when no OpenFGA store is configured, only the node owner is authorized.
 * Side-effects: IO (DB read).
 * Links: nodes/operator/app/src/app/api/v1/vcs/{flight,merge}/route.ts, docs/spec/rbac.md
 * @public
 */

import type { AuthzAction, AuthzDecisionCode } from "@cogni/authorization-core";
import { billingAccounts } from "@cogni/db-schema/refs";
import { eq } from "drizzle-orm";
import { getContainer, resolveServiceDb } from "@/bootstrap/container";

export type NodeActionAuthzErrorCode = Extract<
  AuthzDecisionCode,
  "authz_denied" | "authz_unavailable"
>;

export type AuthorizeNodeActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: number;
      readonly errorCode:
        | NodeActionAuthzErrorCode
        | "node_not_found"
        | "billing_account_missing";
    };

/**
 * Authorize a node-scoped VCS action for a session user.
 * `action` defaults to `node.flight` — V0's merge route reuses `can_flight` as the gate
 * (a documented least-privilege concession; a dedicated `node.merge`/`can_merge` is vNext).
 */
export async function authorizeNodeAction(params: {
  readonly sessionUser: {
    readonly id: string;
    readonly displayName?: string | null;
  };
  readonly node: { readonly id: string; readonly ownerUserId: string };
  readonly action?: AuthzAction;
}): Promise<AuthorizeNodeActionResult> {
  const container = getContainer();
  const authorization = container.authorization;

  if (!authorization) {
    return params.node.ownerUserId === params.sessionUser.id
      ? { ok: true }
      : { ok: false, status: 404, errorCode: "node_not_found" };
  }

  const db = resolveServiceDb();
  const billingAccountRows = await db
    .select({ id: billingAccounts.id })
    .from(billingAccounts)
    .where(eq(billingAccounts.ownerUserId, params.sessionUser.id))
    .limit(1);
  const billingAccount = billingAccountRows[0];
  if (!billingAccount) {
    return { ok: false, status: 403, errorCode: "billing_account_missing" };
  }

  const decision = await authorization.check({
    actorId: `user:${params.sessionUser.id}`,
    action: params.action ?? "node.flight",
    resource: `node:${params.node.id}`,
    context: {
      tenantId: billingAccount.id,
      nodeId: params.node.id,
    },
  });

  if (decision.decision === "allow") return { ok: true };
  return {
    ok: false,
    status: decision.code === "authz_unavailable" ? 503 : 403,
    errorCode: decision.code as NodeActionAuthzErrorCode,
  };
}
