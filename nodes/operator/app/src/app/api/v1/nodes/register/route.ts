// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/nodes/register`
 * Purpose: Register an EXISTING GitHub repo as a managed node row owned by the caller — the
 *   operator-as-git-manager-for-N-repos primitive. Unlike the wizard create path (which mints a NEW
 *   node + repo and reserves `operator`/`node-template`), this anchors an already-existing repo so an
 *   RBAC-gated agent can be granted on it and run flight/secrets/sync via the operator itself.
 * Scope: Session-gated, idempotent. Inserts identity/ownership only; `infra/catalog/*.yaml` stays the
 *   deploy SSoT (CATALOG_IS_SSOT). Caller supplies the repo coords; no hardcoded node list.
 *   V0_GATE: any authenticated caller may register a repo they name (idempotent — first registrant
 *   owns the slug; re-register is a no-op). Hardening to a governance-approver gate is a tracked
 *   follow-up before prod.
 * Invariants: AUTH_REQUIRED, SLUG_KEBAB, USER_ROW_ENSURED, IDEMPOTENT (onConflictDoNothing on slug),
 *   NODES_TABLE_SCOPE (identity/ownership/RBAC anchor only — never the deploy SSoT).
 * Side-effects: IO (Postgres)
 * Links: story.5009, docs/spec/identity-model.md, docs/spec/node-baas-architecture.md
 * @public
 */

import { withTenantScope } from "@cogni/db-client";
import { users } from "@cogni/db-schema/refs";
import { type UserId, userActor } from "@cogni/ids";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveAppDb } from "@/bootstrap/container";
import { getServerSessionUser } from "@/lib/auth/server";
import { nodes } from "@/shared/db/nodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SLUG_KEBAB mirrors parseNodeSlug's format rule, but WITHOUT the reserved-slug block — registering
// an existing repo legitimately uses names the wizard reserves (e.g. `operator`, `node-template`).
const SLUG_RE = /^[a-z][a-z0-9-]{1,31}$/;
const GH_OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/;
const GH_REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;

const RegisterInput = z.object({
  slug: z.string().regex(SLUG_RE, "slug must be kebab-case (a-z, 0-9, -)"),
  repoOwner: z.string().regex(GH_OWNER_RE, "invalid GitHub owner"),
  repoName: z.string().regex(GH_REPO_RE, "invalid GitHub repo name"),
});

export async function POST(request: Request) {
  const session = await getServerSessionUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = RegisterInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid input", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { slug, repoOwner, repoName } = parsed.data;
  const repoUrl = `https://github.com/${repoOwner}/${repoName}`;
  const db = resolveAppDb();

  // USER_ROW_ENSURED: nodes.owner_user_id FKs users.id. Mirror the wizard create path.
  await withTenantScope(db, userActor(session.id as UserId), async (tx) =>
    tx
      .insert(users)
      .values({
        id: session.id,
        walletAddress: session.walletAddress ?? null,
        name: session.displayName ?? null,
      })
      .onConflictDoNothing({ target: users.id })
  );

  const inserted = await withTenantScope(
    db,
    userActor(session.id as UserId),
    async (tx) =>
      tx
        .insert(nodes)
        .values({
          slug,
          repoUrl,
          repoOwner,
          repoName,
          repoVisibility: "public",
          ownerUserId: session.id,
          status: "active",
        })
        .onConflictDoNothing({ target: nodes.slug })
        .returning()
  );

  if (inserted.length === 0) {
    // IDEMPOTENT: already registered. Return the row if the caller owns it; otherwise report taken.
    const existing = await withTenantScope(
      db,
      userActor(session.id as UserId),
      async (tx) => tx.select().from(nodes).where(eq(nodes.slug, slug)).limit(1)
    );
    if (existing[0]) {
      return NextResponse.json({ node: existing[0], alreadyRegistered: true });
    }
    return NextResponse.json(
      { error: "slug already registered by another owner", slug },
      { status: 409 }
    );
  }

  return NextResponse.json({ node: inserted[0] }, { status: 201 });
}
