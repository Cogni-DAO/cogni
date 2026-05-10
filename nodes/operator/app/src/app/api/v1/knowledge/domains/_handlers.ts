// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/knowledge/domains/_handlers`
 * Purpose: HTTP handlers for the knowledge domain registry — list + register.
 *   Pulls KnowledgeStorePort from the container, maps typed errors to HTTP.
 * Scope: Operator-side wiring only. Cookie-session only (server rejects Bearer).
 * Invariants: VALIDATE_IO, AUTH_VIA_GETSESSIONUSER, DOMAIN_HTTP_COOKIE_ONLY,
 *   DOMAIN_REGISTRY_VIA_UI.
 * Side-effects: IO (HTTP response, Doltgres read/write via container port)
 * Links: docs/spec/knowledge-domain-registry.md
 * @internal
 */

import {
  DomainAlreadyRegisteredError,
} from "@cogni/knowledge-store";
import {
  DomainsCreateRequestSchema,
  DomainsCreateResponseSchema,
  DomainsListResponseSchema,
} from "@cogni/node-contracts";
import type { SessionUser } from "@cogni/node-shared";
import { NextResponse } from "next/server";

import { getContainer } from "@/bootstrap/container";

function port() {
  return getContainer().knowledgeStorePort ?? null;
}

function isBearer(request: Request): boolean {
  const authz = request.headers.get("authorization") ?? "";
  return authz.toLowerCase().startsWith("bearer ");
}

export async function handleList(
  request: Request,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isBearer(request))
    return NextResponse.json(
      { error: "knowledge domains require a session cookie (v0)" },
      { status: 403 }
    );
  const p = port();
  if (!p)
    return NextResponse.json(
      { error: "knowledge store not configured" },
      { status: 503 }
    );
  const domains = await p.listDomainsFull();
  return NextResponse.json(DomainsListResponseSchema.parse({ domains }));
}

export async function handleCreate(
  request: Request,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isBearer(request))
    return NextResponse.json(
      { error: "knowledge domain registration requires a session cookie" },
      { status: 403 }
    );
  const p = port();
  if (!p)
    return NextResponse.json(
      { error: "knowledge store not configured" },
      { status: 503 }
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = DomainsCreateRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "invalid input", issues: parsed.error.issues },
      { status: 400 }
    );

  try {
    const domain = await p.registerDomain({
      id: parsed.data.id,
      name: parsed.data.name,
      ...(parsed.data.description != null
        ? { description: parsed.data.description }
        : {}),
    });
    return NextResponse.json(DomainsCreateResponseSchema.parse(domain), {
      status: 201,
    });
  } catch (e: unknown) {
    if (e instanceof DomainAlreadyRegisteredError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}
