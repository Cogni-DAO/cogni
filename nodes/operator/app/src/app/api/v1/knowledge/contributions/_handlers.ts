// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/knowledge/contributions/_handlers`
 * Purpose: HTTP handlers for the external-agent knowledge contribution surface.
 *   Pulls the framework-agnostic ContributionService from the container, maps
 *   SessionUser → Principal, and translates typed service errors to HTTP statuses.
 * Scope: Operator-side wiring only. Mirrors poly's identical handler set.
 * Invariants: VALIDATE_IO, AUTH_VIA_GETSESSIONUSER, KNOWLEDGE_MERGE_REQUIRES_ADMIN_SESSION.
 * Side-effects: IO (HTTP response, Doltgres read/write via container service)
 * Links: docs/design/knowledge-contribution-api.md, packages/knowledge-store
 * @internal
 */

import {
  ContributionCloseRequestSchema,
  ContributionMergeRequestSchema,
  ContributionsCreateRequestSchema,
  ContributionsListQuerySchema,
} from "@cogni/node-contracts";
import {
  ContributionConflictError,
  ContributionForbiddenError,
  ContributionNotFoundError,
  ContributionQuotaError,
  ContributionStateError,
  sessionUserToPrincipal,
} from "@cogni/knowledge-store";
import type { SessionUser } from "@cogni/node-shared";
import { NextResponse } from "next/server";

import { getContainer } from "@/bootstrap/container";

function service() {
  const svc = getContainer().knowledgeContributionService;
  if (!svc) {
    return null;
  }
  return svc;
}

function mapError(e: unknown): NextResponse {
  if (e instanceof ContributionForbiddenError)
    return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof ContributionNotFoundError)
    return NextResponse.json({ error: e.message }, { status: 404 });
  if (e instanceof ContributionStateError)
    return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof ContributionConflictError)
    return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof ContributionQuotaError)
    return NextResponse.json({ error: e.message }, { status: 429 });
  throw e;
}

export async function handleCreate(
  request: Request,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = service();
  if (!svc)
    return NextResponse.json(
      { error: "knowledge contribution service not configured" },
      { status: 503 }
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = ContributionsCreateRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "invalid input", issues: parsed.error.issues },
      { status: 400 }
    );

  const principal = sessionUserToPrincipal(sessionUser);
  const body_ = {
    message: parsed.data.message,
    entries: parsed.data.entries,
    ...(parsed.data.idempotencyKey
      ? { idempotencyKey: parsed.data.idempotencyKey }
      : {}),
  };
  try {
    const record = await svc.create({ principal, body: body_ });
    return NextResponse.json(record, { status: 201 });
  } catch (e) {
    return mapError(e);
  }
}

export async function handleList(
  request: Request,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = service();
  if (!svc)
    return NextResponse.json(
      { error: "knowledge contribution service not configured" },
      { status: 503 }
    );

  const url = new URL(request.url);
  const stateParam = url.searchParams.get("state");
  const principalIdParam = url.searchParams.get("principalId");
  const limitParam = url.searchParams.get("limit");

  const parsed = ContributionsListQuerySchema.safeParse({
    state: stateParam ?? undefined,
    principalId: principalIdParam ?? undefined,
    limit: limitParam ? Number(limitParam) : undefined,
  });
  if (!parsed.success)
    return NextResponse.json(
      { error: "invalid query", issues: parsed.error.issues },
      { status: 400 }
    );

  const principal = sessionUserToPrincipal(sessionUser);
  const query = {
    state: parsed.data.state,
    limit: parsed.data.limit,
    ...(parsed.data.principalId
      ? { principalId: parsed.data.principalId }
      : {}),
  };
  const records = await svc.list({ principal, query });
  return NextResponse.json({ contributions: records });
}

export async function handleGetById(
  contributionId: string,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = service();
  if (!svc)
    return NextResponse.json(
      { error: "knowledge contribution service not configured" },
      { status: 503 }
    );

  const record = await svc.getById(contributionId);
  if (!record)
    return NextResponse.json(
      { error: `contribution not found: ${contributionId}` },
      { status: 404 }
    );
  return NextResponse.json(record);
}

export async function handleDiff(
  contributionId: string,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = service();
  if (!svc)
    return NextResponse.json(
      { error: "knowledge contribution service not configured" },
      { status: 503 }
    );

  const record = await svc.getById(contributionId);
  if (!record)
    return NextResponse.json(
      { error: `contribution not found: ${contributionId}` },
      { status: 404 }
    );
  const entries = await svc.diff(contributionId);
  return NextResponse.json({
    contributionId,
    branch: record.branch,
    entries,
  });
}

export async function handleMerge(
  request: Request,
  contributionId: string,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = service();
  if (!svc)
    return NextResponse.json(
      { error: "knowledge contribution service not configured" },
      { status: 503 }
    );

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = ContributionMergeRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "invalid input", issues: parsed.error.issues },
      { status: 400 }
    );

  const principal = sessionUserToPrincipal(sessionUser);
  try {
    const result = await svc.merge({
      principal,
      contributionId,
      ...(parsed.data.confidencePct != null
        ? { confidencePct: parsed.data.confidencePct }
        : {}),
    });
    return NextResponse.json({ contributionId, ...result });
  } catch (e) {
    return mapError(e);
  }
}

export async function handleClose(
  request: Request,
  contributionId: string,
  sessionUser: SessionUser | null
): Promise<NextResponse> {
  if (!sessionUser)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = service();
  if (!svc)
    return NextResponse.json(
      { error: "knowledge contribution service not configured" },
      { status: 503 }
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = ContributionCloseRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "invalid input", issues: parsed.error.issues },
      { status: 400 }
    );

  const principal = sessionUserToPrincipal(sessionUser);
  try {
    await svc.close({
      principal,
      contributionId,
      reason: parsed.data.reason,
    });
    return NextResponse.json({ contributionId, closed: true });
  } catch (e) {
    return mapError(e);
  }
}
