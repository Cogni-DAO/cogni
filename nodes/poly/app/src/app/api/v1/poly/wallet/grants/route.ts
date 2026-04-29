// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/grants`
 * Purpose: HTTP GET + PUT for the calling user's active wallet-grants row. Powers the Money-page policy editor (task.0347). Read returns `{configured, connected, grant}`; write applies a partial update of `(per_order_usdc_cap, daily_usdc_cap)` only.
 * Scope: Thin route shell — Zod validate, delegate to facade, map facade errors to HTTP. No DB access here. v1 surface explicitly excludes `hourly_fills_cap` editing.
 * Invariants:
 *   - TENANT_SCOPED: facade reads/writes via `withTenantScope(appDb, sessionUser.id)`. Tenant comes from session, never the wire.
 *   - CHECK_AT_WIRE: PUT body validated against contract refinement (`daily >= per_order`, `> 0`); 422 returned with `code: 'invalid_caps'` before any DB call.
 *   - SAFE_SUCCESS_SHAPE: GET returns 200 with `connected: false` for users without an active grant — never 404 (the Money page falls back to onboarding messaging).
 * Side-effects: IO via facade.
 * Links: docs/spec/poly-multi-tenant-auth.md,
 *        docs/spec/poly-trader-wallet-port.md,
 *        nodes/poly/packages/node-contracts/src/poly.wallet.grants.v1.contract.ts,
 *        nodes/poly/app/src/app/_facades/poly/wallet-grants.server.ts,
 *        work/items/task.0347.poly-wallet-preferences-sizing-config.md
 * @public
 */

import {
  type PolyWalletGrantsErrorOutput,
  type PolyWalletGrantsGetOutput,
  type PolyWalletGrantsPutOutput,
  polyWalletGrantsErrorOutput,
  polyWalletGrantsGetOperation,
  polyWalletGrantsPutOperation,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import {
  getWalletGrantsFacade,
  PolyWalletGrantsError,
  putWalletGrantsFacade,
} from "@/app/_facades/poly/wallet-grants.server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";

export const dynamic = "force-dynamic";

function errorResponse(
  err: PolyWalletGrantsError,
  status: number
): NextResponse<PolyWalletGrantsErrorOutput> {
  const body: PolyWalletGrantsErrorOutput = polyWalletGrantsErrorOutput.parse({
    code: err.code,
    message: err.message,
  });
  return NextResponse.json(body, { status });
}

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.grants.read",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, _request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");
    const result: PolyWalletGrantsGetOutput = await getWalletGrantsFacade(
      sessionUser,
      ctx.log
    );
    return NextResponse.json(polyWalletGrantsGetOperation.output.parse(result));
  }
);

export const PUT = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.grants.write",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const err = new PolyWalletGrantsError(
        "invalid_caps",
        "Request body must be valid JSON"
      );
      return errorResponse(err, 400);
    }

    const parsed = polyWalletGrantsPutOperation.input.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join("; ");
      const err = new PolyWalletGrantsError("invalid_caps", message);
      return errorResponse(err, 422);
    }

    try {
      const result: PolyWalletGrantsPutOutput = await putWalletGrantsFacade(
        sessionUser,
        parsed.data,
        ctx.log
      );
      return NextResponse.json(
        polyWalletGrantsPutOperation.output.parse(result)
      );
    } catch (err) {
      if (err instanceof PolyWalletGrantsError) {
        const status = err.code === "no_active_grant" ? 404 : 422;
        return errorResponse(err, status);
      }
      throw err;
    }
  }
);
