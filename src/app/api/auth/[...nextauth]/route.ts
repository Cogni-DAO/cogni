// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/auth/[...nextauth]`
 * Purpose: Expose NextAuth handlers for signin/session routes. On OAuth callback
 *   routes, reads link_intent cookie and propagates intent via AsyncLocalStorage.
 * Scope: Link-intent logic runs only on callback routes. Does not perform DB
 *   verification or binding — delegates to signIn callback in auth.ts.
 * Invariants: Public infrastructure endpoint; session cookies managed by NextAuth.
 *   Link intent is fail-closed: if JWT decode fails, the intent is rejected (never ignored).
 * Side-effects: IO (NextAuth DB operations via Drizzle client, cookie read/clear)
 * Links: src/auth.ts, src/shared/auth/link-intent-store.ts
 * @public
 */

import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { decode } from "next-auth/jwt";

import { authOptions, authSecret } from "@/auth";
import {
  type LinkIntent,
  linkIntentStore,
} from "@/shared/auth/link-intent-store";

export const runtime = "nodejs";

const LINK_INTENT_COOKIE = "link_intent";
const LINK_INTENT_SALT = "link-intent";

const nextAuthHandler = NextAuth(authOptions);

/** True when the request path is an OAuth callback (the only route needing link intent). */
function isCallbackRoute(segments: string[]): boolean {
  return segments[0] === "callback";
}

async function handler(
  req: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  const segments = await context.params.then((p) => p.nextauth);
  const isCallback = isCallbackRoute(segments);
  const linkIntentCookie = req.cookies.get(LINK_INTENT_COOKIE)?.value;

  // Only decode link_intent on callback routes — other routes (providers,
  // session, csrf) don't invoke signIn and may return non-NextResponse objects.
  let linkIntent: LinkIntent | null = null;
  if (linkIntentCookie && isCallback) {
    try {
      const decoded = await decode({
        token: linkIntentCookie,
        secret: authSecret,
        salt: LINK_INTENT_SALT,
      });

      if (
        decoded?.purpose === "link_intent" &&
        typeof decoded.txId === "string" &&
        typeof decoded.userId === "string"
      ) {
        linkIntent = { txId: decoded.txId, userId: decoded.userId };
      } else {
        linkIntent = { failed: true, reason: "invalid_jwt_payload" };
      }
    } catch {
      linkIntent = { failed: true, reason: "invalid_jwt" };
    }
  }

  const response = await linkIntentStore.run(linkIntent, () =>
    nextAuthHandler(req, context)
  );

  // Clear link_intent cookie after callback processing. Callback routes return
  // a NextResponse (redirect), which supports .cookies. Non-callback routes
  // (providers, session) may return plain objects — we skip those entirely.
  if (linkIntentCookie && isCallback && response?.cookies) {
    response.cookies.set(LINK_INTENT_COOKIE, "", {
      httpOnly: true,
      // biome-ignore lint/style/noProcessEnv: auth infra runs before serverEnv() is available
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}

export { handler as GET, handler as POST };
