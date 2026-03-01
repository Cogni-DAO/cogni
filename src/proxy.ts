// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@/proxy`
 * Purpose: Next.js 16 proxy (formerly middleware) for route protection.
 * Scope: Root-level proxy. Enforces session auth on /api/v1/* routes and page-level routing (redirect unauthenticated users away from app routes, redirect authenticated users from landing to /chat). Does not handle public infrastructure endpoints (e.g., /api/metrics, /api/health).
 * Invariants: /api/v1/public/* accessible without auth; other /api/v1/* require session.
 *   Single authority for auth routing — no client-side redirect logic.
 * Side-effects: none
 * Links: docs/spec/security-auth.md
 * @public
 */

/* eslint-disable boundaries/no-unknown-files */

import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

import { authOptions, authSecret } from "@/auth";

/** App routes that require authentication — unauthenticated visitors are redirected to /. */
const APP_ROUTES = [
  "/chat",
  "/profile",
  "/credits",
  "/gov",
  "/schedules",
  "/setup",
  "/work",
  "/activity",
];

function isAppRoute(pathname: string): boolean {
  return APP_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Allow public namespace without authentication
  if (pathname.startsWith("/api/v1/public/")) {
    return NextResponse.next();
  }

  // Resolve token once — reused for both page and API checks.
  // Only call getToken when the route actually needs auth checking.
  const needsAuth =
    pathname === "/" || isAppRoute(pathname) || pathname.startsWith("/api/v1/");
  const tokenSecret = authSecret || authOptions.secret;

  if (!tokenSecret && pathname.startsWith("/api/v1/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token =
    tokenSecret && needsAuth
      ? await getToken({ req, secret: tokenSecret })
      : null;

  const isLoggedIn = !!token;

  // --- Page-level routing (single authority, replaces client-side redirects) ---

  // Authenticated on landing page → redirect to /chat
  if (pathname === "/" && isLoggedIn) {
    return NextResponse.redirect(new URL("/chat", req.url));
  }

  // Unauthenticated on app routes → redirect to /
  if (isAppRoute(pathname) && !isLoggedIn) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // --- API route protection ---

  // Protect /api/v1/* routes (except /api/v1/public/* which was early-returned above)
  // IMPORTANT: All route handlers under /api/v1 must still call getServerSession() server-side.
  // This proxy provides early rejection for unauthenticated requests, but handlers
  // are responsible for their own auth enforcement.
  // Public unauthenticated endpoints must use /api/v1/public/* namespace.
  if (pathname.startsWith("/api/v1/")) {
    if (!isLoggedIn) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run proxy on page routes (landing + app) and API routes for uniform auth perimeter
  matcher: [
    "/",
    "/chat/:path*",
    "/profile/:path*",
    "/credits/:path*",
    "/gov/:path*",
    "/schedules/:path*",
    "/setup/:path*",
    "/work/:path*",
    "/activity/:path*",
    "/api/v1/:path*",
  ],
};
