// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/auto-wrap/consent`
 * Purpose: HTTP POST + DELETE — grant or revoke the calling user's consent to
 *   the auto-wrap loop (task.0429). The 60s job converts idle USDC.e at the
 *   funder address to spendable pUSD whenever the balance crosses the floor.
 * Scope: Wire-shape + auth boundary only. Domain logic lives behind
 *   `PolyTraderWalletPort.{setAutoWrapConsent, revokeAutoWrapConsent}`.
 * Invariants:
 *   - TENANT_SCOPED: tenant derived from the session billing account; body
 *     cannot override.
 *   - CONSENT_REVOCABLE: revoke is a single DB UPDATE; honored next tick.
 *   - DUST_GUARD: optional `floorUsdceAtomic` is validated > 0 by the Zod
 *     contract; the DB CHECK is the backstop.
 * Side-effects: IO (DB writes only). The auto-wrap job is fire-and-forget.
 * Links: work/items/task.0429.poly-auto-wrap-consent-loop.md
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  type PolyWalletAutoWrapConsentGrantOutput,
  type PolyWalletAutoWrapConsentRevokeOutput,
  polyWalletAutoWrapConsentGrantOperation,
  polyWalletAutoWrapConsentRevokeOperation,
} from "@cogni/poly-node-contracts";
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
    routeId: "poly.wallet.auto_wrap.consent.grant",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    const rawBody = await request.json().catch(() => ({}));
    const parsed =
      polyWalletAutoWrapConsentGrantOperation.input.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_request", issues: parsed.error.issues },
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
        return NextResponse.json(
          { error: "wallet_adapter_unconfigured" },
          { status: 503 }
        );
      }
      throw err;
    }

    const floorAtomic =
      parsed.data.floorUsdceAtomic !== undefined
        ? BigInt(parsed.data.floorUsdceAtomic)
        : undefined;

    try {
      await adapter.setAutoWrapConsent({
        billingAccountId: account.id,
        actorKind: "user",
        actorId: sessionUser.id,
        ...(floorAtomic !== undefined ? { floorUsdceAtomic: floorAtomic } : {}),
      });
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code: string }).code
          : null;
      if (code === "no_connection") {
        return NextResponse.json(
          { error: "no_active_connection" },
          { status: 409 }
        );
      }
      throw err;
    }

    const summary = await adapter.getConnectionSummary(account.id);
    if (!summary || summary.autoWrapConsentAt === null) {
      // Race: revoked between set + read. Surface as 409 — caller retries.
      return NextResponse.json(
        { error: "consent_state_inconsistent" },
        { status: 409 }
      );
    }

    const payload: PolyWalletAutoWrapConsentGrantOutput = {
      auto_wrap_consent_at: summary.autoWrapConsentAt.toISOString(),
      floor_usdce_atomic: summary.autoWrapFloorUsdceAtomic.toString(),
    };
    return NextResponse.json(
      polyWalletAutoWrapConsentGrantOperation.output.parse(payload)
    );
  }
);

export const DELETE = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.auto_wrap.consent.revoke",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, _request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    const container = getContainer();
    const account = await container
      .accountsForUser(toUserId(sessionUser.id))
      .getOrCreateBillingAccountForUser({ userId: sessionUser.id });

    let adapter: ReturnType<typeof getPolyTraderWalletAdapter>;
    try {
      adapter = getPolyTraderWalletAdapter(ctx.log);
    } catch (err) {
      if (err instanceof WalletAdapterUnconfiguredError) {
        return NextResponse.json(
          { error: "wallet_adapter_unconfigured" },
          { status: 503 }
        );
      }
      throw err;
    }

    await adapter.revokeAutoWrapConsent({
      billingAccountId: account.id,
      actorKind: "user",
      actorId: sessionUser.id,
    });

    const payload: PolyWalletAutoWrapConsentRevokeOutput = {
      auto_wrap_revoked_at: new Date().toISOString(),
    };
    return NextResponse.json(
      polyWalletAutoWrapConsentRevokeOperation.output.parse(payload)
    );
  }
);
