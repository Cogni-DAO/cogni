// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@/lib/auth/server`
 * Purpose: Canonical server-side session helper for Auth4.
 * Scope: Server-only. Wraps NextAuth's getServerSession with invariant enforcement. Do not use on client.
 * Invariants: Returns null unless both id AND walletAddress are present (wallet-first auth).
 * Side-effects: IO (NextAuth session retrieval)
 * Links: docs/spec/authentication.md
 * @public
 */

import { getServerSession } from "next-auth";

import { authOptions } from "@/auth";
import type { SessionUser } from "@/shared/auth";

export async function getServerSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  const walletAddress = session?.user?.walletAddress;

  // Enforce wallet-first invariant: require both id and walletAddress
  if (!(id && walletAddress)) {
    return null;
  }

  return { id, walletAddress };
}
