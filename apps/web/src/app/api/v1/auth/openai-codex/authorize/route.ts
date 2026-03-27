// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/auth/openai-codex/authorize`
 * Purpose: Initiate OpenAI Codex Device Code flow for BYO-AI.
 * Scope: Calls OpenAI device auth endpoint, returns user code + verification URL.
 *   No cookies, no redirect URI, no PKCE — works from any deployment.
 * Invariants:
 *   - TOKENS_NEVER_LOGGED: No credentials in logs
 * Side-effects: IO (HTTP request to OpenAI)
 * Links: docs/research/openai-oauth-byo-ai.md
 * @public
 */

import { NextResponse } from "next/server";

import { getServerSessionUser } from "@/lib/auth/server";
import { makeLogger } from "@/shared/observability";

export const runtime = "nodejs";

const log = makeLogger({ component: "openai-codex-authorize" });

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_DEVICE_CODE_URL =
  "https://auth.openai.com/api/accounts/deviceauth/usercode";
const VERIFICATION_URL = "https://auth.openai.com/codex/device";

export async function POST() {
  const session = await getServerSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const response = await fetch(OPENAI_DEVICE_CODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: OPENAI_CLIENT_ID }),
    });

    if (!response.ok) {
      log.error(
        { status: response.status },
        "OpenAI device code request failed"
      );
      return NextResponse.json(
        { error: "Failed to start authentication" },
        { status: 502 }
      );
    }

    const data = await response.json();
    const userCode = data.user_code ?? data.usercode;
    const interval = Number(data.interval) || 5;

    if (!data.device_auth_id || !userCode) {
      log.error("OpenAI device code response missing required fields");
      return NextResponse.json(
        { error: "Unexpected response from OpenAI" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      deviceAuthId: data.device_auth_id,
      userCode,
      interval,
      verificationUrl: VERIFICATION_URL,
    });
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "OpenAI device code request error"
    );
    return NextResponse.json(
      { error: "Failed to connect to OpenAI" },
      { status: 502 }
    );
  }
}
