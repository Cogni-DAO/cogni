// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-sync-service/adapters/dolthub-http-remote`
 * Purpose: SEAM for the DoltHub HTTP SQL/write API path. NOT wired as a pusher in v0.
 * Scope: Documents the spike outcome + reserves the read-side reconciliation surface.
 * Invariants:
 *   - push() throws — the HTTP write path is a proven dead end for v0 (see below).
 *   - When this seam is realized it is READ-side only (remote dolt_log lag check), built
 *     per the third-party-integrator skill: Zod-contract every response + .safeParse,
 *     AbortSignal.timeout on every call, never log raw response bodies (DoltHub echoes
 *     the Authorization token verbatim in error bodies — verified 2026-06-03).
 *
 * 2026-06-03 spike (live, against a throwaway DoltHub repo with the prod PAT):
 *   - POST /api/v1alpha1/{owner}/{repo}/write/{from}/{to} returns query_execution_status
 *     "Success" but commits NOTHING — `to_commit_id` is always empty and no branch's
 *     dolt_log advances. Reproduced for DDL, DML, and `--allow-empty` dolt_commit, with
 *     both `Bearer` and `token` auth schemes, for main→main and main→newbranch.
 *   - There is no repo-DELETE REST endpoint (only POST /database create).
 *   - Error bodies echo the Authorization header in plaintext (token-leak vector).
 *   Conclusion: PAT authenticates reads + repo-create + branch-create, but cannot write.
 *   The live writer is the GRPC `dolt_push` path (DoltGrpcRemoteAdapter).
 *
 * Side-effects: none (throws on use)
 * Links: docs/spec/knowledge-data-plane.md, work/handoffs/task.5069.spike-findings.md
 * @public
 */

import {
  type DoltPushResult,
  type DoltRemotePort,
  DoltRemotePortError,
} from "../ports/dolt-remote.port.js";

export interface DoltHubHttpRemoteConfig {
  node: string;
  /** e.g. https://www.dolthub.com/api/v1alpha1 */
  apiBaseUrl: string;
  owner: string;
  repo: string;
  /** PAT — `Authorization: token <pat>`. Reads only; cannot push (see module doc). */
  apiToken: string;
}

export function createDoltHubHttpRemoteAdapter(
  config: DoltHubHttpRemoteConfig
): DoltRemotePort {
  return {
    kind: "http",
    push(): Promise<DoltPushResult> {
      return Promise.reject(
        new DoltRemotePortError(
          "DoltHub HTTP write API silently no-ops (2026-06-03 spike); use the GRPC dolt_push path",
          config.node
        )
      );
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
}
