// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/layout`
 * Purpose: Auth guard layout with sidebar navigation for protected application pages.
 * Scope: Client layout component that enforces authentication and provides sidebar + top bar shell for all routes under (app). Does not handle business logic or page content.
 * Invariants: Requires valid session to render children; redirects unauthenticated to home; no auto sign-out.
 * Side-effects: IO (NextAuth session retrieval via client hook, Next.js navigation)
 * Notes: All pages under (app)/* require authentication. Auth session is source of truth.
 * Links: docs/spec/security-auth.md
 * @public
 */

"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { SidebarInset, SidebarProvider } from "@/components";
import { AppSidebar, AppTopBar } from "@/features/layout";

export default function AppLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const { status } = useSession();
  const router = useRouter();

  // Redirect unauthenticated users to home
  // Note: No auto sign-out here - sign-out must be explicit user action
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/");
    }
  }, [status, router]);

  // Loading state
  if (status === "loading") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Redirect in progress or no session
  if (status === "unauthenticated") {
    return null;
  }

  // Authenticated: render sidebar layout
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppTopBar />
        <div className="flex flex-1 flex-col overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
