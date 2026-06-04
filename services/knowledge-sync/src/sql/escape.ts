// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-sync-service/sql/escape`
 * Purpose: Minimal SQL literal escaping + the HARD SAFETY destructive-op guard.
 * Scope: Pure string helpers. No IO, no state.
 * Invariants:
 *   - escapeRef rejects anything outside the safe Dolt ref charset.
 *   - assertAdditive throws on any destructive Dolt op (reset/drop/force/truncate/delete).
 *     This is defense-in-depth: the adapters only ever build `dolt_remote add` +
 *     `dolt_push` (no force), but the guard makes the push/additive-only invariant
 *     structural and catches any future edit that strays. A `reset --hard` mirror
 *     seed is exactly what truncated 688 work_items and took candidate-a down.
 * Side-effects: none
 * Notes: escapeValue/escapeRef mirror packages/knowledge-store/.../doltgres/util.ts
 *   (kept local so the service's dep graph stays {pino,postgres,prom-client,zod}).
 * Links: docs/spec/knowledge-data-plane.md
 * @internal
 */

export function escapeValue(val: string): string {
  return `'${val.replace(/\0/g, "").replace(/'/g, "''")}'`;
}

export function escapeRef(ref: string): string {
  if (!/^[a-zA-Z0-9_./~^-]+$/.test(ref)) {
    throw new Error(`Invalid Dolt ref: ${ref}`);
  }
  return `'${ref}'`;
}

/** Destructive operations this worker must NEVER emit. */
const DESTRUCTIVE = [
  /\bdolt_reset\b/i,
  /\bdolt_revert\b/i,
  /--force\b/i,
  /\bdrop\s+(table|database|branch)\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\bdolt_branch\b.*-[dD]\b/i,
];

/**
 * Throw if `sql` contains any destructive operation. Push/additive ONLY —
 * a non-fast-forward `dolt_push` is rejected by the remote (safe); a forced
 * push or reset would overwrite published history. Never allowed.
 */
export function assertAdditive(sql: string): void {
  for (const pattern of DESTRUCTIVE) {
    if (pattern.test(sql)) {
      throw new Error(
        `knowledge-sync refused a destructive SQL op (push/additive only): ${pattern}`
      );
    }
  }
}
