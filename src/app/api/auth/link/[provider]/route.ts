// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/auth/link/[provider]`
 * Purpose: Account linking initiation endpoint. Sets a signed link_intent cookie
 *   then redirects to NextAuth's standard OAuth flow.
 * Scope: Requires existing session. Sets HttpOnly cookie. Does not perform binding itself.
 * Invariants: LINKING_IS_EXPLICIT — only authenticated users can initiate linking.
 *   Cookie is session-bound (sessionTokenHash), time-limited (5min), HttpOnly, Secure, SameSite=Lax.
 * Side-effects: IO (cookie set, redirect)
 * Links: src/app/api/auth/[...nextauth]/route.ts, src/shared/auth/link-intent-store.ts
 * @public
 */

import { createHash } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";

import { authSecret } from "@/auth";
import { getServerSessionUser } from "@/lib/auth/server";

export const runtime = "nodejs";

const ALLOWED_PROVIDERS = new Set(["github", "discord", "google"]);
const SESSION_COOKIE = "next-auth.session-token";
const LINK_INTENT_COOKIE = "link_intent";
const LINK_INTENT_SALT = "link-intent";
const LINK_INTENT_TTL = 5 * 60; // 5 minutes

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  if (!ALLOWED_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  // Require existing session
  const session = await getServerSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Session binding: hash current session token for replay prevention
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json(
      { error: "Session cookie missing" },
      { status: 401 }
    );
  }
  const sessionTokenHash = createHash("sha256")
    .update(sessionToken)
    .digest("hex")
    .slice(0, 16);

  // Create a signed JWT containing the user ID + session hash (tamper-proof)
  const linkToken = await encode({
    token: {
      userId: session.id,
      sessionTokenHash,
      purpose: "link_intent",
    },
    secret: authSecret,
    salt: LINK_INTENT_SALT,
    maxAge: LINK_INTENT_TTL,
  });

  // Set HttpOnly cookie — SameSite=Lax allows top-level navigation (OAuth redirect)
  cookieStore.set(LINK_INTENT_COOKIE, linkToken, {
    httpOnly: true,
    // biome-ignore lint/style/noProcessEnv: auth infra runs before serverEnv() is available
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LINK_INTENT_TTL,
  });

  // Redirect to NextAuth's standard OAuth flow with callbackUrl back to profile
  // biome-ignore lint/style/noProcessEnv: auth infra runs before serverEnv() is available
  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const redirectUrl = new URL(`/api/auth/signin/${provider}`, baseUrl);
  redirectUrl.searchParams.set(
    "callbackUrl",
    `/profile?linked=${encodeURIComponent(provider)}`
  );
  return NextResponse.redirect(redirectUrl);
}
