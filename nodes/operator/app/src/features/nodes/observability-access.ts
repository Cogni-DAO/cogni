// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/nodes/observability-access`
 * Purpose: v0 of the Substrate Access-Grant plane (north-star ②, task.5025) — resolve the
 *   observability READ credential the operator ISSUES to a developer-RBAC'd dev so they can
 *   query their deployment's Grafana/Loki **directly** (the operator is NOT a query proxy).
 * Scope: Pure decision over the operator's env-held shared Viewer token. No network, no auth.
 *   v0 = the env's shared `_shared` Viewer token (read-only but NOT node-scoped). Per-node
 *   isolation (label-scoped `glc_` access-policy tokens, minted per principal) is vNext —
 *   see `docs/spec/substrate-access-grant.md`.
 * Invariants:
 *   - ISSUER_NOT_PROXY: the operator holds the token only to hand it to an RBAC'd dev at
 *     grant time; it never self-queries Loki for a verdict (that's the assertLive anti-pattern).
 *   - GRACEFUL_UNWIRED: both inputs absent ⇒ `unwired` (route → 503), never a partial credential.
 *   - SHARED_ENV_LEAK_DISCLOSED: the v0 credential is env-wide; the caveat names the breach-line.
 * Side-effects: none (pure)
 * Links: docs/spec/grafana-observability-access.md, docs/spec/substrate-access-grant.md, task.5025
 * @public
 */

export type ObservabilityScope = "shared-env-viewer";

/** v0 isolation is env-wide: the shared Viewer token reads EVERY node's logs in the env. */
export type ObservabilityIsolation = "none-shared-env";

export interface ObservabilityAccessUnwired {
  readonly status: "unwired";
}

export interface ObservabilityAccessGranted {
  readonly status: "granted";
  readonly grafanaUrl: string;
  /** Read-only Grafana/Loki credential. Authed + RBAC-gated transport only; never logged. */
  readonly token: string;
  readonly scope: ObservabilityScope;
  readonly isolation: ObservabilityIsolation;
  readonly caveat: string;
}

export type ObservabilityAccess =
  | ObservabilityAccessUnwired
  | ObservabilityAccessGranted;

/**
 * The v0 breach-line, surfaced in the response so a caller cannot mistake env-wide shared
 * read for per-node isolation. Below this line (all node-devs Cogni-trusted) v0 is acceptable;
 * the first untrusted external node-dev is the written trigger to the vNext per-node mint.
 */
export const SHARED_ENV_CAVEAT =
  "v0 shared-env Viewer token: read-only but NOT node-scoped — it can query EVERY node's logs in this " +
  "env. Acceptable only while all node developers are Cogni-trusted. Per-node isolation (label-scoped " +
  "glc_ access-policy tokens, minted per principal) is vNext — see docs/spec/substrate-access-grant.md.";

/**
 * Resolve the observability access the operator can ISSUE for a node, from its env-held
 * shared Viewer credential. Pure: callers pass the two env values; HTTP/auth/RBAC stay in the route.
 */
export function resolveObservabilityAccess(input: {
  readonly grafanaUrl: string | undefined;
  readonly viewerToken: string | undefined;
}): ObservabilityAccess {
  if (!input.grafanaUrl || !input.viewerToken) {
    return { status: "unwired" };
  }
  return {
    status: "granted",
    grafanaUrl: input.grafanaUrl,
    token: input.viewerToken,
    scope: "shared-env-viewer",
    isolation: "none-shared-env",
    caveat: SHARED_ENV_CAVEAT,
  };
}
