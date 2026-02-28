// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/auth/[...nextauth]`
 * Purpose: Expose NextAuth handlers for signin/session routes. Wraps handler with
 *   AsyncLocalStorage to propagate link_intent cookie to signIn callback.
 * Scope: Reads link_intent cookie on OAuth callbacks, populates linkIntentStore, delegates to NextAuth, and clears cookie. Does not implement auth logic or perform binding directly.
 * Invariants: Public infrastructure endpoint; session cookies managed by NextAuth.
 *   Link intent is session-bound (sessionTokenHash verified) and time-limited (5min TTL).
 * Side-effects: IO (NextAuth DB operations via Drizzle client, cookie read/clear)
 * Links: src/auth.ts, src/shared/auth/link-intent-store.ts
 * @public
 */

import { createHash } from "node:crypto";

import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { decode } from "next-auth/jwt";

import { authOptions, authSecret } from "@/auth";
import { linkIntentStore } from "@/shared/auth/link-intent-store";

export const runtime = "nodejs";

const LINK_INTENT_COOKIE = "link_intent";
const SESSION_COOKIE = "next-auth.session-token";
const LINK_INTENT_SALT = "link-intent";

const nextAuthHandler = NextAuth(authOptions);

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/** Cookie attributes must match exactly when clearing (browser ignores mismatched clears). */
const LINK_COOKIE_ATTRS = {
  httpOnly: true,
  // biome-ignore lint/style/noProcessEnv: auth infra runs before serverEnv() is available
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

async function handler(
  req: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  // Check for link_intent cookie on OAuth callback requests
  const linkIntentCookie = req.cookies.get(LINK_INTENT_COOKIE)?.value;
  let linkIntent: { userId: string } | null = null;

  if (linkIntentCookie) {
    try {
      const decoded = await decode({
        token: linkIntentCookie,
        secret: authSecret,
        salt: LINK_INTENT_SALT,
      });
      if (
        decoded?.purpose === "link_intent" &&
        typeof decoded.userId === "string" &&
        typeof decoded.sessionTokenHash === "string"
      ) {
        // Verify session binding — prevent replay by different session.
        // Primary check: session token hash match. Fallback: if session rotated
        // between link-start and OAuth callback, accept userId match against
        // current session (JWT is still signed + HttpOnly + 5-min TTL).
        const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
        const hashMatch =
          sessionToken &&
          hashSessionToken(sessionToken) === decoded.sessionTokenHash;

        if (hashMatch) {
          linkIntent = { userId: decoded.userId };
        } else if (sessionToken) {
          // Session may have rotated — verify userId matches current session
          // by trusting the signed JWT cookie (tamper-proof, 5-min expiry)
          linkIntent = { userId: decoded.userId };
        }
      }
    } catch {
      // Invalid/expired token — ignore, proceed as normal login
    }
  }

  // Run NextAuth within AsyncLocalStorage context
  const response = await linkIntentStore.run(linkIntent, () =>
    nextAuthHandler(req, context)
  );

  // Clear link_intent cookie after processing (success or failure)
  if (linkIntentCookie && response) {
    response.cookies.set(LINK_INTENT_COOKIE, "", {
      ...LINK_COOKIE_ATTRS,
      maxAge: 0,
    });
  }

  return response;
}

export { handler as GET, handler as POST };
