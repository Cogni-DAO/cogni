// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/util/session-to-principal`
 * Purpose: Map a SessionUser-shaped object to the `Principal` accepted by the
 *   contribution service. Bearer-authenticated agents have no walletAddress
 *   and become `kind: 'agent'`. Wallet-authenticated session users become
 *   `kind: 'user', role: 'admin'` — v0 admin gate is "any session-cookie user."
 * Scope: Pure transformation. Structural input type so this package stays
 *   independent of `@cogni/node-shared`.
 * Invariants: KNOWLEDGE_MERGE_REQUIRES_ADMIN_SESSION (v0).
 * Side-effects: none
 * Links: docs/design/knowledge-contribution-api.md
 * @public
 */

import type { Principal } from "../domain/contribution-schemas.js";

export interface SessionUserLike {
  id: string;
  walletAddress: string | null;
  displayName: string | null;
}

export function sessionUserToPrincipal(u: SessionUserLike): Principal {
  if (u.walletAddress) {
    return {
      id: u.id,
      kind: "user",
      role: "admin",
      ...(u.displayName ? { name: u.displayName } : {}),
    };
  }
  return {
    id: u.id,
    kind: "agent",
    ...(u.displayName ? { name: u.displayName } : {}),
  };
}
