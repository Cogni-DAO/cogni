// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/auth/session`
 * Purpose: Canonical session identity type shared across layers.
 * Scope: Minimal user identity fields used by app facades and adapters; does not contain runtime behavior.
 * Invariants: id is always DB UUID; contains only serializable primitives; no runtime behavior. walletAddress is null for OAuth-only users.
 * Side-effects: none
 * Notes: walletAddress is null when user authenticated via OAuth (GitHub) without a linked wallet.
 * Links: app/_lib/auth/session, docs/spec/security-auth.md
 * @public
 */
export interface SessionUser {
  /**
   * Primary database identifier (UUID).
   * Maps to `users.id` in the `auth` schema.
   * NEVER use wallet address here; use `walletAddress` field instead.
   */
  id: string;
  walletAddress: string | null;
}
