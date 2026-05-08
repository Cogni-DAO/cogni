// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/util/session-to-principal`
 * Purpose: Maps a SessionUser-shaped object to the Principal accepted by the contribution service.
 * Scope: Pure transformation; structural input type keeps this package independent of `@cogni/node-shared`. Does not call I/O or read env vars.
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
