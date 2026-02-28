// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/auth/[...nextauth]`
 * Purpose: Expose NextAuth handlers for signin/session routes. Wraps handler with
 *   AsyncLocalStorage to propagate link intent to signIn callback.
 * Scope: Reads link_intent cookie on OAuth callbacks, decodes JWT, populates linkIntentStore with pending or failed intent, delegates to NextAuth, and clears cookie. Does not perform DB verification or binding.
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
  let linkIntent: LinkIntent | null = null;

  if (linkIntentCookie) {
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
        // Pass raw decoded data — auth.ts signIn callback will do the
        // atomic DB consume (it has getServiceDb access).
        linkIntent = { txId: decoded.txId, userId: decoded.userId };
      } else {
        linkIntent = { failed: true, reason: "invalid_jwt_payload" };
      }
    } catch {
      // Invalid/expired JWT token → fail closed
      linkIntent = { failed: true, reason: "invalid_jwt" };
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
