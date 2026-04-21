// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/connect`
 * Purpose: HTTP POST — provision a per-tenant Polymarket trading wallet via
 *   the `PolyTraderWalletPort`. Idempotent per the port contract. First slice
 *   of task.0318 Phase B; allows exercising the Privy-per-user plumbing on
 *   candidate-a before the full onboarding UX ships.
 * Scope: Thin validator; delegates to the adapter. No on-chain allowances
 *   here (B3), no grant issuance here (B4), no withdraw here (follow-up).
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
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";

export const dynamic = "force-dynamic";

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

    // Agent-actor path requires API-key-bound auth (follow-up slice); until
    // then, reject with 501 rather than leaving an unguarded enum branch
    // that a session-authed user could take without any actor-id check.
    if (parsed.data.custodialConsentActorKind === "agent") {
      return NextResponse.json(
        {
          error: "Agent-actor consent path not yet implemented",
          reason: "agent API-key auth lands in a follow-up B3 slice",
        },
        { status: 501 }
      );
    }

    // Defense-in-depth: session-authed user path — actor_id MUST match the
    // session user's id.
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

    const result = await adapter.provision({
      billingAccountId: account.id,
      createdByUserId: sessionUser.id,
      custodialConsent: {
        acceptedAt: new Date(),
        actorKind: parsed.data.custodialConsentActorKind,
        actorId: parsed.data.custodialConsentActorId,
      },
    });

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
