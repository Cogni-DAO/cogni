// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/work/items/route`
 * Purpose: HTTP endpoints for listing and creating work items.
 * Scope: Auth-protected GET (list — markdown ∪ Doltgres) and POST (create — Doltgres only).
 * Invariants: VALIDATE_IO, CONTRACTS_ARE_TRUTH, AUTH_VIA_GETSESSIONUSER, ID_RANGE_RESERVED.
 * Side-effects: IO (HTTP response, filesystem read via port, Doltgres read/write)
 * Links: contracts/work.items.{list,create}.v1.contract, work/items/task.0423.doltgres-work-items-source-of-truth.md
 * @public
 */

import {
  workItemsCreateOperation,
  workItemsListOperation,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";

import {
  createWorkItem,
  listWorkItems,
  WorkItemsBackendNotReadyError,
} from "@/app/_facades/work/items.server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/work/items — List work items with optional query filters.
 *
 * Query params: types, statuses (comma-separated), text, projectId, node (single
 * or comma-separated), limit. Lists span both legacy markdown items and
 * Doltgres-allocated items (≥5000) — their ID ranges are disjoint.
 */
export const GET = wrapRouteHandlerWithLogging(
  { routeId: "work.items.list", auth: { mode: "required", getSessionUser } },
  async (ctx, request) => {
    const url = new URL(request.url);

    const typesParam = url.searchParams.get("types");
    const statusesParam = url.searchParams.get("statuses");
    const textParam = url.searchParams.get("text");
    const actorParam = url.searchParams.get("actor");
    const projectIdParam = url.searchParams.get("projectId");
    const nodeParam = url.searchParams.get("node");
    const limitParam = url.searchParams.get("limit");

    const input = workItemsListOperation.input.parse({
      types: typesParam ? typesParam.split(",") : undefined,
      statuses: statusesParam ? statusesParam.split(",") : undefined,
      text: textParam ?? undefined,
      actor: actorParam ?? undefined,
      projectId: projectIdParam ?? undefined,
      node: nodeParam
        ? nodeParam.includes(",")
          ? nodeParam.split(",")
          : nodeParam
        : undefined,
      limit: limitParam ? Number(limitParam) : undefined,
    });

    const result = await listWorkItems(input);

    ctx.log.info({ count: result.items.length }, "work.items.list_success");

    return NextResponse.json(workItemsListOperation.output.parse(result));
  }
);

/**
 * POST /api/v1/work/items — Create a new work item in Doltgres.
 *
 * Server allocates an ID in the reserved 5000+ range per type
 * (ID_RANGE_RESERVED). Author is derived from `getSessionUser` and embedded in
 * the dolt_log commit message (AUTHOR_ATTRIBUTED).
 */
export const POST = wrapRouteHandlerWithLogging(
  { routeId: "work.items.create", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser) => {
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const parseResult = workItemsCreateOperation.input.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "invalid input", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    try {
      const created = await createWorkItem(parseResult.data, {
        id: sessionUser.id,
        displayName: sessionUser.displayName,
      });
      ctx.log.info(
        { workItemId: created.id, node: created.node },
        "work.items.create_success"
      );
      return NextResponse.json(workItemsCreateOperation.output.parse(created), {
        status: 201,
      });
    } catch (e) {
      if (e instanceof WorkItemsBackendNotReadyError) {
        return NextResponse.json({ error: e.message }, { status: 503 });
      }
      if ((e as Error)?.name === "WorkItemAlreadyExistsError") {
        return NextResponse.json(
          { error: (e as Error).message },
          { status: 409 }
        );
      }
      throw e;
    }
  }
);
