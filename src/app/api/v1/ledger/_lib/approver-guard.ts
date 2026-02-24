// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/ledger/_lib/approver-guard`
 * Purpose: Checks if a SIWE session wallet is in the ledger approvers allowlist.
 * Scope: Pure check against repo-spec config. No database or side effects. Does not perform database access.
 * Invariants: WRITE_ROUTES_APPROVER_GATED — all ledger write routes must call this before mutations.
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md, .cogni/repo-spec.yaml
 * @internal
 */

import { NextResponse } from "next/server";
import { getLedgerApprovers } from "@/shared/config";
import type { RequestContext } from "@/shared/observability";
import { logRequestWarn } from "@/shared/observability";

/**
 * Returns a 403 response if the session wallet is not in the ledger approvers list.
 * Returns null if the caller is authorized.
 */
export function checkApprover(
  ctx: RequestContext,
  walletAddress: string | null | undefined
): NextResponse | null {
  if (!walletAddress) {
    logRequestWarn(ctx.log, { walletAddress }, "LEDGER_NO_WALLET");
    return NextResponse.json(
      { error: "Wallet address required" },
      { status: 403 }
    );
  }

  const approvers = getLedgerApprovers();
  if (!approvers.includes(walletAddress.toLowerCase())) {
    logRequestWarn(
      ctx.log,
      { walletAddress: `${walletAddress.slice(0, 10)}...` },
      "LEDGER_NOT_APPROVER"
    );
    return NextResponse.json(
      { error: "Not authorized as ledger approver" },
      { status: 403 }
    );
  }

  return null;
}
