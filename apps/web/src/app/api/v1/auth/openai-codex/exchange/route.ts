// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/auth/openai-codex/exchange`
 * Purpose: Accept a pasted redirect URL and complete the OAuth token exchange.
 * Scope: POST endpoint. Extracts code + state from the pasted URL, validates PKCE state,
 *   exchanges code for tokens, encrypts and stores connection. Used when the localhost:1455
 *   relay is not available (cloud deployments).
 * Invariants:
 *   - PKCE_REQUIRED: Code exchange uses verifier from signed cookie
 *   - STATE_VALIDATED: State in URL must match cookie
 *   - ENCRYPTED_AT_REST: Tokens stored via AEAD with AAD binding
 *   - TOKENS_NEVER_LOGGED: No tokens in logs or responses
 * Side-effects: IO (HTTP token exchange, DB insert, cookie delete)
 * Links: docs/research/openai-oauth-byo-ai.md
 * @public
 */

import { randomUUID } from "node:crypto";
import { connections } from "@cogni/db-schema";
import type { UserId } from "@cogni/ids";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";

import { authSecret } from "@/auth";
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
const PKCE_COOKIE = "codex_pkce";
const PKCE_SALT = "codex-pkce";

export async function POST(request: Request) {
  const session = await getServerSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Parse the pasted URL from request body
  let pastedUrl: string;
  try {
    const body = await request.json();
    pastedUrl = body.url;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!pastedUrl || typeof pastedUrl !== "string") {
    return NextResponse.json({ error: "Missing url field" }, { status: 400 });
  }

  // Extract code and state from the pasted URL
  let code: string;
  let state: string;
  try {
    const parsed = new URL(pastedUrl);
    code = parsed.searchParams.get("code") ?? "";
    state = parsed.searchParams.get("state") ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
  }

  if (!code || !state) {
    return NextResponse.json(
      { error: "URL missing code or state parameter" },
      { status: 400 }
    );
  }

  // Validate PKCE cookie
  const cookieStore = await cookies();
  const pkceCookie = cookieStore.get(PKCE_COOKIE);
  if (!pkceCookie?.value) {
    return NextResponse.json(
      { error: "Session expired — please try connecting again" },
      { status: 400 }
    );
  }

  cookieStore.delete(PKCE_COOKIE);

  const payload = await decode({
    token: pkceCookie.value,
    secret: authSecret,
    salt: PKCE_SALT,
  });

  if (
    !payload ||
    payload.purpose !== "codex_pkce" ||
    payload.userId !== session.id ||
    payload.state !== state
  ) {
    return NextResponse.json(
      { error: "State mismatch — please try connecting again" },
      { status: 400 }
    );
  }

  const verifier = payload.verifier as string;

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
      "BYO-AI connection created via manual exchange"
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
