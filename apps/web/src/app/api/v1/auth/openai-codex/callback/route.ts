// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/auth/openai-codex/callback`
 * Purpose: OAuth callback for OpenAI Codex BYO-AI. Exchanges code for tokens, encrypts, stores in connections table.
 * Scope: GET endpoint called by OpenAI redirect. Validates state, exchanges code via PKCE, encrypts tokens with AEAD,
 *   upserts connection row, redirects to profile page.
 * Invariants:
 *   - PKCE_REQUIRED: Code exchange uses verifier from signed cookie
 *   - STATE_VALIDATED: State param must match cookie
 *   - ENCRYPTED_AT_REST: Tokens stored via AEAD with AAD binding
 *   - TENANT_SCOPED: Connection belongs to authenticated user's billing account
 *   - TOKENS_NEVER_LOGGED: No tokens in logs or error messages
 *   - COOKIE_CONSUMED: PKCE cookie deleted after use
 * Side-effects: IO (HTTP token exchange, DB insert, cookie delete)
 * Links: docs/research/openai-oauth-byo-ai.md, docs/spec/tenant-connections.md
 * @public
 */

import { randomUUID } from "node:crypto";
import { connections } from "@cogni/db-schema";
import type { UserId } from "@cogni/ids";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decode } from "next-auth/jwt";

import { authSecret } from "@/auth";
import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { getOrCreateBillingAccountForUser } from "@/lib/auth/mapping";
import { getServerSessionUser } from "@/lib/auth/server";
import { aeadEncrypt } from "@/shared/crypto/aead";
import { makeLogger } from "@/shared/observability";

export const runtime = "nodejs";

const log = makeLogger({ component: "openai-codex-callback" });

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const PKCE_COOKIE = "codex_pkce";
const PKCE_SALT = "codex-pkce";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    log.warn({ error }, "OpenAI OAuth error");
    redirect("/profile?error=oauth_denied");
  }

  if (!code || !state) {
    redirect("/profile?error=oauth_missing_params");
  }

  const session = await getServerSessionUser();
  if (!session) {
    redirect("/profile?error=not_authenticated");
  }

  // Read and consume PKCE cookie (one-time use)
  const cookieStore = await cookies();
  const pkceCookie = cookieStore.get(PKCE_COOKIE);
  if (!pkceCookie?.value) {
    redirect("/profile?error=pkce_expired");
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
    log.warn("PKCE cookie validation failed — state mismatch or tampered");
    redirect("/profile?error=oauth_state_mismatch");
  }

  const verifier = payload.verifier as string;
  // Token exchange must use the same redirect_uri that was sent to the authorize endpoint.
  // The Codex public client is locked to localhost:1455.
  const callbackUrl = "http://localhost:1455/auth/callback";

  // Exchange authorization code for tokens
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
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      log.error(
        { status: tokenResponse.status },
        "OpenAI token exchange failed"
      );
      redirect("/profile?error=token_exchange_failed");
    }

    tokenData = await tokenResponse.json();
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "OpenAI token exchange request failed"
    );
    redirect("/profile?error=token_exchange_failed");
  }

  // Extract account ID from access token JWT claims
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
    // Non-fatal — accountId is optional
  }

  // Resolve billing account
  const container = getContainer();
  const accountService = container.accountsForUser(session.id as UserId);
  const billingAccount = await getOrCreateBillingAccountForUser(
    accountService,
    { userId: session.id }
  );

  // AEAD encrypt tokens
  const encKeyHex = serverEnv().CONNECTIONS_ENCRYPTION_KEY;
  if (!encKeyHex) {
    log.error("CONNECTIONS_ENCRYPTION_KEY not set — cannot store connection");
    redirect("/profile?error=config_error");
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

  // Upsert: revoke existing, insert new
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
      "BYO-AI connection created"
    );
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "Failed to store connection"
    );
    redirect("/profile?error=storage_failed");
  }

  redirect("/profile?linked=chatgpt");
}
