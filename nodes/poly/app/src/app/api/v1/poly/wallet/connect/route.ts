// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/connect`
 * Purpose: HTTP POST — provision a per-tenant Polymarket trading wallet via
 *   the `PolyTraderWalletPort`. Idempotent per the port contract. First slice
 *   of task.0318 Phase B; allows exercising the Privy-per-user plumbing on
 *   candidate-a before the full onboarding UX ships.
 * Scope: Thin validator; delegates to the adapter. No on-chain allowances
 *   here; default execution-cap grant issuance is delegated to
 *   `provisionWithGrant`; no withdraw here (follow-up).
 * Invariants:
 *   - CUSTODIAL_CONSENT: request must carry `custodialConsentAcknowledged:
 *     true`; backend persists the acceptance on the row.
 *   - TENANT_SCOPED: tenant is derived from the authenticated session's
 *     billing account; the request body cannot override it.
 *   - SEPARATE_PRIVY_APP: enforced at adapter construction time (see
 *     `@/adapters/server/wallet#getPolyTraderWalletAdapter`).
 * Side-effects: IO (Privy API call, DB writes).
 * Links: docs/spec/poly-trader-wallet-port.md, work/items/task.0318
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  type PolyWalletConnectOutput,
  polyWalletConnectOperation,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  checkConnectRateLimit,
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";

export const dynamic = "force-dynamic";

function readErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object" || !("code" in err)) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function clobProvisioningStatus(code: string): number {
  if (code === "clob_upstream_rate_limited") return 429;
  if (code === "clob_upstream_unauthorized") return 502;
  if (code === "clob_upstream_forbidden") return 502;
  if (code === "clob_cloudflare_blocked") return 502;
  if (code.startsWith("clob_upstream_")) return 502;
  return 500;
}

export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.connect",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = polyWalletConnectOperation.input.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    // Contract narrows `custodialConsentActorKind` to the literal `"user"` in
    // v0 (agent-API-key auth lands in B3 and widens it then). Defense-in-depth:
    // session-authed user path — actor_id MUST match the session user's id.
    if (parsed.data.custodialConsentActorId !== sessionUser.id) {
      return NextResponse.json(
        { error: "Consent actor id mismatches session user" },
        { status: 400 }
      );
    }

    const container = getContainer();
    const account = await container
      .accountsForUser(toUserId(sessionUser.id))
      .getOrCreateBillingAccountForUser({ userId: sessionUser.id });

    // Rate-limit: bound the connect→revoke→connect churn path. Only 429 when
    // the tenant's most-recent row is both revoked and still inside the cooldown
    // window. Idempotent re-hits with an active row fall through to the adapter,
    // which short-circuits inside the advisory lock without calling Privy.
    const rateLimit = await checkConnectRateLimit(account.id);
    if (rateLimit.limited) {
      ctx.log.warn(
        {
          billing_account_id: account.id,
          user_id: sessionUser.id,
          retry_after_seconds: rateLimit.retryAfterSeconds,
        },
        "poly.wallet.connect rate-limited — recent revoke in cooldown window"
      );
      return NextResponse.json(
        {
          error: "Too many wallet provisioning attempts",
          retry_after_seconds: rateLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        }
      );
    }

    let adapter: ReturnType<typeof getPolyTraderWalletAdapter>;
    try {
      adapter = getPolyTraderWalletAdapter(ctx.log);
    } catch (err) {
      if (err instanceof WalletAdapterUnconfiguredError) {
        ctx.log.warn(
          { err: err.message },
          "poly.wallet.connect rejected — adapter unconfigured"
        );
        return NextResponse.json(
          {
            error: "Poly trading wallets not configured on this deployment",
            reason: err.message,
          },
          { status: 503 }
        );
      }
      throw err;
    }

    let result: Awaited<ReturnType<typeof adapter.provisionWithGrant>>;
    try {
      result = await adapter.provisionWithGrant({
        billingAccountId: account.id,
        createdByUserId: sessionUser.id,
        custodialConsent: {
          acceptedAt: new Date(),
          actorKind: parsed.data.custodialConsentActorKind,
          actorId: parsed.data.custodialConsentActorId,
        },
        defaultGrant: {
          perOrderUsdcCap: parsed.data.defaultGrant.perOrderUsdcCap,
          dailyUsdcCap: parsed.data.defaultGrant.dailyUsdcCap,
        },
      });
    } catch (err) {
      const errorCode = readErrorCode(err);
      if (errorCode?.startsWith("clob_")) {
        ctx.log.warn(
          {
            billing_account_id: account.id,
            user_id: sessionUser.id,
            error_code: errorCode,
          },
          "poly.wallet.connect rejected — CLOB credential provisioning unavailable"
        );
        return NextResponse.json(
          {
            error:
              errorCode === "clob_cloudflare_blocked"
                ? "Polymarket CLOB blocked this deployment while creating trading credentials"
                : "Polymarket CLOB could not create trading credentials",
            error_code: errorCode,
          },
          { status: clobProvisioningStatus(errorCode) }
        );
      }
      throw err;
    }

    const payload: PolyWalletConnectOutput = {
      connection_id: result.connectionId,
      funder_address: result.funderAddress,
      requires_funding: true,
      suggested_usdc: 5,
      suggested_matic: 0.1,
    };
    ctx.log.info(
      {
        billing_account_id: account.id,
        connection_id: result.connectionId,
        funder_address: result.funderAddress,
        actor_kind: parsed.data.custodialConsentActorKind,
      },
      "poly.wallet.connect — provisioned per-tenant Polymarket trading wallet"
    );
    return NextResponse.json(polyWalletConnectOperation.output.parse(payload));
  }
);
