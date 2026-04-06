// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@mcp/run-scope-store`
 * Purpose: Ephemeral per-run bearer token store for MCP tool bridge authentication.
 * Scope: Stores RunScope keyed by opaque token. TTL enforced. Does NOT perform I/O.
 * Invariants:
 *   - EPHEMERAL_TOKEN: tokens are created per-run, deleted in finally block
 *   - TOKEN_TTL: expired tokens are rejected; lazy cleanup on access
 *   - TOKEN_OPAQUE: tokens are crypto-random UUIDs, not JWTs (no claims to decode)
 * Side-effects: none (in-memory Map)
 * Links: bug.0300
 * @internal
 */

import { randomUUID } from "node:crypto";

/**
 * Execution scope associated with a bearer token.
 * Created by CodexLlmAdapter before spawning Codex, consumed by MCP server.
 */
export interface RunScope {
  readonly runId: string;
  readonly userId: string;
  readonly graphId: string;
  /** Tool IDs this run is allowed to use (from graph's tool manifest) */
  readonly toolIds: readonly string[];
  /** Absolute expiry time (Date.now() + TTL) */
  readonly expiresAt: number;
}

/** Default TTL: 30 minutes (generous for long agent runs) */
const DEFAULT_TTL_MS = 30 * 60 * 1000;

/**
 * In-memory store for ephemeral run scope tokens.
 * Module-scoped singleton — shared across all MCP requests within the process.
 */
const store = new Map<string, RunScope>();

/**
 * Generate a bearer token and store the associated run scope.
 *
 * @param scope - Run scope (without expiresAt, which is auto-set)
 * @param ttlMs - Token TTL in milliseconds (default: 30 min)
 * @returns Opaque bearer token (UUID)
 */
export function generateRunToken(
  scope: Omit<RunScope, "expiresAt">,
  ttlMs = DEFAULT_TTL_MS
): string {
  const token = randomUUID();
  store.set(token, {
    ...scope,
    expiresAt: Date.now() + ttlMs,
  });
  return token;
}

/**
 * Resolve a bearer token to its run scope.
 * Returns undefined if token is missing or expired.
 * Expired tokens are lazily deleted on access.
 *
 * @param token - Bearer token from Authorization header
 * @returns RunScope if valid, undefined otherwise
 */
export function resolveRunToken(token: string): RunScope | undefined {
  const scope = store.get(token);
  if (!scope) return undefined;

  if (Date.now() > scope.expiresAt) {
    store.delete(token);
    return undefined;
  }

  return scope;
}

/**
 * Delete a token (called in CodexLlmAdapter's finally block).
 *
 * @param token - Bearer token to revoke
 */
export function deleteRunToken(token: string): void {
  store.delete(token);
}

/**
 * Get current store size (for observability/tests).
 */
export function getStoreSize(): number {
  return store.size;
}

/**
 * Clear all tokens (for tests only).
 */
export function clearAllTokens(): void {
  store.clear();
}
