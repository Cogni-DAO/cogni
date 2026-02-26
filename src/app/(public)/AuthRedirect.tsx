// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(public)/AuthRedirect`
 * Purpose: Client-side redirect to /chat when session becomes authenticated (e.g., after SIWE sign-in).
 * Scope: Watches NextAuth session status and navigates on change. Renders nothing. Does not handle sign-out or session management.
 * Invariants: Only redirects on "authenticated" status; no render output.
 * Side-effects: IO (Next.js navigation)
 * Links: src/app/(public)/page.tsx
 * @public
 */

"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";

export function AuthRedirect(): null {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/chat");
    }
  }, [status, router]);

  return null;
}
