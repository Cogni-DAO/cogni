// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-sync-service/ports/dolt-remote`
 * Purpose: Port for replicating a node's Doltgres knowledge DB to its DoltHub remote.
 * Scope: Interface + typed error + result shape only. No IO, no framework deps.
 * Invariants:
 *   - push() is ADDITIVE ONLY — a whole-DB fast-forward `dolt_push`. Never destructive.
 *   - push() throws DoltRemotePortError on any failure; the caller logs + drops it
 *     (MIRROR_BEST_EFFORT_NO_RETRY — never blocks, never retries within a tick).
 * Side-effects: none (interface)
 * Links: docs/spec/knowledge-data-plane.md
 * @public
 */

export interface DoltPushResult {
  node: string;
  remote: string;
  branch: string;
  /** Free-form status echoed from the backend (e.g. dolt_push output), if any. */
  detail?: string;
}

/** Typed error boundary — every adapter failure is translated to this. */
export class DoltRemotePortError extends Error {
  override readonly name = "DoltRemotePortError";
  constructor(
    message: string,
    readonly node: string,
    override readonly cause?: unknown
  ) {
    super(message);
  }
}

/**
 * A single node's mirror target. Adapters:
 *   - DoltGrpcRemoteAdapter   — LIVE. `dolt_push` over the Doltgres SQL connection
 *     (creds live in the Doltgres server). The path proven to land commits on DoltHub.
 *   - DoltHubHttpRemoteAdapter — SEAM. DoltHub HTTP SQL/write API. The 2026-06-03
 *     spike proved the PAT write endpoint silently no-ops (commits nothing); reserved
 *     for read-side reconciliation (lag check) once that's needed. Do not use to push.
 *   - FakeDoltRemoteAdapter    — CI. Records calls, no IO.
 */
export interface DoltRemotePort {
  /** Discriminator for logs/metrics (e.g. "grpc", "http", "fake"). */
  readonly kind: string;
  /** Additive whole-DB fast-forward push. Throws DoltRemotePortError on failure. */
  push(signal?: AbortSignal): Promise<DoltPushResult>;
  /** Release any held connections. */
  close(): Promise<void>;
}
