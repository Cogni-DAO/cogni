// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/internal/ops/poly/wallet/rotate-clob-creds`
 * Purpose: Internal operations endpoint that rotates encrypted per-tenant
 *   Polymarket CLOB L2 API credentials after exposure or controlled maintenance.
 * Scope: Bearer-auth POST endpoint for operators. Delegates credential work to
 *   `PolyTraderWalletPort.rotateClobCreds`; never returns key material.
 * Invariants:
 *   - INTERNAL_OPS_AUTH: Requires Bearer INTERNAL_OPS_TOKEN.
 *   - OPS_ONLY_ROTATION: no product UI/session-auth route exposes this action.
 *   - NO_SECRET_EGRESS: response includes ids + wallet address only; logs carry
 *     counts/error classes only.
 * Side-effects: Polymarket CLOB API key deletion/creation, encrypted DB update,
 *   process-local executor cache invalidation.
 * Links: docs/spec/poly-trader-wallet-port.md, work/items/bug.5007
 * @internal
 */

import { timingSafeEqual } from "node:crypto";
import { polyWalletConnections } from "@cogni/poly-db-schema";
import {
  type PolyWalletRotateClobCredsOutput,
  polyWalletRotateClobCredsOperation,
} from "@cogni/poly-node-contracts";
import { asc, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getContainer, resolveServiceDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import { serverEnv } from "@/shared/env";
import { EVENT_NAMES, logEvent } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AUTH_HEADER_LENGTH = 512;
const MAX_TOKEN_LENGTH = 256;

type RotateTarget = {
  readonly billingAccountId: string;
};

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  if (authHeader.length > MAX_AUTH_HEADER_LENGTH) return null;

  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;

  const token = trimmed.slice(7).trim();
  if (token.length > MAX_TOKEN_LENGTH) return null;

  return token;
}

function classifyRotationError(error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (typeof code === "string" && /^[a-z0-9_:-]{1,64}$/i.test(code)) {
    return code;
  }
  return "rotate_failed";
}

function aggregateFailureCode(
  failed: readonly { readonly error_code: string }[]
): string {
  if (failed.length === 0) return "none";
  const first = failed[0]?.error_code ?? "rotate_failed";
  return failed.every((item) => item.error_code === first)
    ? first
    : "rotate_failed";
}

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function resolveTargets(input: {
  readonly rotate_all: boolean;
  readonly billing_account_id?: string | undefined;
}): Promise<readonly RotateTarget[]> {
  if (input.billing_account_id) {
    return [{ billingAccountId: input.billing_account_id }];
  }

  const serviceDb = resolveServiceDb();
  const rows = await serviceDb
    .select({ billingAccountId: polyWalletConnections.billingAccountId })
    .from(polyWalletConnections)
    .where(isNull(polyWalletConnections.revokedAt))
    .orderBy(asc(polyWalletConnections.billingAccountId));

  return rows;
}

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "poly.wallet.rotate_clob_creds.ops", auth: { mode: "none" } },
  async (ctx, request) => {
    const env = serverEnv();
    const configuredToken = env.INTERNAL_OPS_TOKEN;
    if (!configuredToken) {
      ctx.log.error("INTERNAL_OPS_TOKEN not configured");
      return NextResponse.json(
        { error: "service_not_configured" },
        { status: 500 }
      );
    }

    const providedToken = extractBearerToken(
      request.headers.get("authorization")
    );
    if (!providedToken || !safeCompare(providedToken, configuredToken)) {
      ctx.log.warn("Invalid or missing INTERNAL_OPS_TOKEN");
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const parsed = polyWalletRotateClobCredsOperation.input.safeParse(
      await parseBody(request)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_rotation_request" },
        { status: 400 }
      );
    }

    const start = performance.now();
    const container = getContainer();

    let adapter: ReturnType<typeof getPolyTraderWalletAdapter>;
    try {
      adapter = getPolyTraderWalletAdapter(ctx.log);
    } catch (error) {
      if (error instanceof WalletAdapterUnconfiguredError) {
        return NextResponse.json(
          { error: "wallet_adapter_unconfigured" },
          { status: 503 }
        );
      }
      throw error;
    }

    const targets = await resolveTargets(parsed.data);
    const rotated: PolyWalletRotateClobCredsOutput["rotated"] = [];
    const skipped: PolyWalletRotateClobCredsOutput["skipped"] = [];
    const failed: PolyWalletRotateClobCredsOutput["failed"] = [];

    for (const target of targets) {
      try {
        const result = await adapter.rotateClobCreds({
          billingAccountId: target.billingAccountId,
        });
        container.invalidatePolyTradeExecutorFor(target.billingAccountId);
        rotated.push({
          billing_account_id: target.billingAccountId,
          connection_id: result.connectionId,
          funder_address: result.funderAddress,
        });
      } catch (error) {
        const errorCode = classifyRotationError(error);
        if (errorCode === "no_connection") {
          skipped.push({
            billing_account_id: target.billingAccountId,
            reason_code: "no_active_connection",
          });
          continue;
        }
        failed.push({
          billing_account_id: target.billingAccountId,
          error_code: errorCode,
        });
      }
    }

    const status = failed.length > 0 ? 500 : 200;
    const errorCode = aggregateFailureCode(failed);
    logEvent(ctx.log, EVENT_NAMES.POLY_WALLET_ROTATE_CLOB_CREDS_COMPLETE, {
      reqId: ctx.reqId,
      routeId: ctx.routeId,
      status,
      durationMs: Math.round(performance.now() - start),
      outcome: failed.length > 0 ? "error" : "success",
      target_count: targets.length,
      rotated_count: rotated.length,
      skipped_count: skipped.length,
      failed_count: failed.length,
      ...(failed.length > 0 ? { errorCode } : {}),
    });

    const payload: PolyWalletRotateClobCredsOutput = {
      target_count: targets.length,
      rotated_count: rotated.length,
      skipped_count: skipped.length,
      failed_count: failed.length,
      rotated,
      skipped,
      failed,
    };

    return NextResponse.json(
      polyWalletRotateClobCredsOperation.output.parse(payload),
      { status }
    );
  }
);
