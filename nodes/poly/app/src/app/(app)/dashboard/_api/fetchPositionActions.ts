// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchPositionActions`
 * Purpose: Browser fetch helpers that POST close (CLOB SELL) and redeem (CTF) actions for the signed-in user's trading wallet on the dashboard.
 * Scope: Thin wrappers around `/api/v1/poly/wallet/positions/*`. Does not construct intents server-side or bypass session auth.
 * Invariants:
 *   - CREDENTIALS_INCLUDE — every request sends cookies so the route can resolve the tenant billing account.
 *   - ERRORS_SURFACE_BODY — failed responses parse JSON `error` / `message` when present for UI display.
 * Side-effects: IO (HTTP POST)
 * Links: nodes/poly/app/src/app/api/v1/poly/wallet/positions/close/route.ts,
 *        nodes/poly/app/src/app/api/v1/poly/wallet/positions/redeem/route.ts
 * @public
 */

import type {
  PolyWalletClosePositionOutput,
  PolyWalletRedeemPositionOutput,
} from "@cogni/poly-node-contracts";

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: string;
      message?: string;
      reason?: string;
    };
    return (
      body.message ??
      body.reason ??
      body.error ??
      `${response.status} ${response.statusText}`
    );
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

export async function postClosePosition(
  tokenId: string
): Promise<PolyWalletClosePositionOutput> {
  const response = await fetch("/api/v1/poly/wallet/positions/close", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token_id: tokenId }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as PolyWalletClosePositionOutput;
}

export async function postRedeemPosition(
  conditionId: string
): Promise<PolyWalletRedeemPositionOutput> {
  const response = await fetch("/api/v1/poly/wallet/positions/redeem", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ condition_id: conditionId }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as PolyWalletRedeemPositionOutput;
}
