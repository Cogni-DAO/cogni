// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_lib/auth/session`
 * Purpose: Server-side session resolver using NextAuth.
 * Scope: Server-only helper that derives a SessionUser from a NextAuth session. Does not perform database access or user existence checks.
 * Invariants: Returns null unless id is present. walletAddress may be null for OAuth-only users.
 * Side-effects: IO (NextAuth session retrieval)
 * Notes: Thin wrapper around NextAuth session retrieval. Supports both wallet (SIWE) and OAuth-only users.
 * Links: docs/spec/security-auth.md
 * @public
 */
import { getServerSessionUser } from "@/lib/auth/server";

export { getServerSessionUser as getSessionUser };
