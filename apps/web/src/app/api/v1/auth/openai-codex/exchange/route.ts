// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/auth/openai-codex/exchange`
 * Purpose: Accept a pasted redirect URL + PKCE verifier, exchange for tokens, store connection.
 * Scope: POST endpoint. Client sends { url, verifier, state } from the authorize flow.
 *   Validates state matches URL, exchanges code via PKCE, encrypts and stores connection.
 * Invariants:
 *   - PKCE_REQUIRED: Code exchange uses verifier from client (held in React state, same as OpenClaw CLI memory)
 *   - ENCRYPTED_AT_REST: Tokens stored via AEAD with AAD binding
 *   - TOKENS_NEVER_LOGGED: No tokens in logs or responses
 * Side-effects: IO (HTTP token exchange, DB insert)
 * Links: docs/research/openai-oauth-byo-ai.md
 * @public
 */

import { randomUUID } from "node:crypto";
import { connections } from "@cogni/db-schema";
import type { UserId } from "@cogni/ids";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { getOrCreateBillingAccountForUser } from "@/lib/auth/mapping";
import { getServerSessionUser } from "@/lib/auth/server";
import { aeadEncrypt } from "@/shared/crypto/aead";
import { serverEnv } from "@/shared/env";
import { makeLogger } from "@/shared/observability";

export const runtime = "nodejs";

const log = makeLogger({ component: "openai-codex-exchange" });

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_REDIRECT_URI = "http://localhost:1455/auth/callback";

export async function POST(request: Request) {
  const session = await getServerSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Parse request body: { url, verifier, state }
  let pastedUrl: string;
  let verifier: string;
  let expectedState: string;
  try {
    const body = await request.json();
    pastedUrl = body.url;
    verifier = body.verifier;
    expectedState = body.state;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!pastedUrl || !verifier || !expectedState) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Extract code and state from the pasted URL
  let code: string;
  let urlState: string;
  try {
    const parsed = new URL(pastedUrl);
    code = parsed.searchParams.get("code") ?? "";
    urlState = parsed.searchParams.get("state") ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json(
      { error: "URL missing authorization code" },
      { status: 400 }
    );
  }

  // Validate state matches
  if (urlState !== expectedState) {
    return NextResponse.json(
      { error: "State mismatch — please try connecting again" },
      { status: 400 }
    );
  }

  // Exchange code for tokens
  let tokenData: {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };

  try {
    const tokenResponse = await fetch(OPENAI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: OPENAI_CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: OPENAI_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      log.error(
        { status: tokenResponse.status },
        "OpenAI token exchange failed"
      );
      return NextResponse.json(
        { error: "Token exchange failed — the code may have expired" },
        { status: 400 }
      );
    }

    tokenData = await tokenResponse.json();
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "OpenAI token exchange request failed"
    );
    return NextResponse.json(
      { error: "Token exchange failed" },
      { status: 500 }
    );
  }

  // Extract account ID from JWT
  let accountId: string | undefined;
  try {
    const [, payloadB64] = tokenData.access_token.split(".");
    if (payloadB64) {
      const claims = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString()
      );
      accountId =
        claims["https://api.openai.com/auth"]?.chatgpt_account_id ?? undefined;
    }
  } catch {
    // Non-fatal
  }

  // Resolve billing account
  const container = getContainer();
  const accountService = container.accountsForUser(session.id as UserId);
  const billingAccount = await getOrCreateBillingAccountForUser(
    accountService,
    { userId: session.id }
  );

  // Encrypt and store
  const encKeyHex = serverEnv().CONNECTIONS_ENCRYPTION_KEY;
  if (!encKeyHex) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }
  const encKey = Buffer.from(encKeyHex, "hex");
  const connectionId = randomUUID();

  const credBlob = JSON.stringify({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? "",
    id_token: tokenData.id_token ?? "",
    account_id: accountId ?? "",
    ...(tokenData.expires_in
      ? {
          expires_at: new Date(
            Date.now() + tokenData.expires_in * 1000
          ).toISOString(),
        }
      : {}),
  });

  const aad = {
    billing_account_id: billingAccount.id,
    connection_id: connectionId,
    provider: "openai-chatgpt" as const,
  };
  const encrypted = aeadEncrypt(credBlob, aad, encKey);

  const db = resolveAppDb();
  try {
    // Revoke existing, insert new
    await db
      .update(connections)
      .set({ revokedAt: new Date(), revokedByUserId: session.id })
      .where(
        and(
          eq(connections.billingAccountId, billingAccount.id),
          eq(connections.provider, "openai-chatgpt"),
          isNull(connections.revokedAt)
        )
      );

    await db.insert(connections).values({
      id: connectionId,
      billingAccountId: billingAccount.id,
      provider: "openai-chatgpt",
      credentialType: "oauth2",
      encryptedCredentials: encrypted,
      encryptionKeyId: "v1",
      scopes: ["openid", "profile", "email", "offline_access"],
      createdByUserId: session.id,
      ...(tokenData.expires_in
        ? { expiresAt: new Date(Date.now() + tokenData.expires_in * 1000) }
        : {}),
    });

    log.info(
      { connectionId, provider: "openai-chatgpt" },
      "BYO-AI connection created"
    );
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "Failed to store connection"
    );
    return NextResponse.json(
      { error: "Failed to store connection" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
