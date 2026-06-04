// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-sync-service/config`
 * Purpose: Environment configuration with Zod validation and lazy singleton.
 * Scope: Config parsing only — no client construction, no side-effects beyond process.env read.
 * Invariants:
 *   - DOLTGRES_URL optional: when unset the worker boots healthy but idles (nothing to read).
 *   - DOLTHUB_REMOTE_URL is the push gate (gate-by-secret-presence per MIRROR_PROD_ONLY_WRITER):
 *     only the production GitHub Environment Secret scope grants it, so candidate-a/preview/dev
 *     boot with the mirror disabled and never push. Matches the operator app's post-merge hook.
 *   - Fails fast with clear errors on invalid config.
 * Side-effects: Reads process.env
 * Links: docs/spec/knowledge-data-plane.md (MIRROR_PROD_ONLY_WRITER, MIRROR_BEST_EFFORT_NO_RETRY),
 *        docs/runbooks/dolthub-remote-bootstrap.md, services/knowledge-sync/Dockerfile
 * @internal
 */

import { z } from "zod";

const optionalString = z
  .string()
  .min(1)
  .optional()
  .or(z.literal("").transform(() => undefined));

const EnvSchema = z.object({
  /** Doltgres connection string for the node's knowledge DB (`knowledge_<node>`).
   * Optional — when unset the worker idles (no DB to push from). Superuser per
   * RUNTIME_URL_IS_SUPERUSER. The DoltHub push creds live in the Doltgres SERVER
   * (install-creds.sh), not here — this URL only triggers `dolt_push` over SQL. */
  DOLTGRES_URL: optionalString,

  /** DoltHub Dolt-remote URL, e.g. `https://doltremoteapi.dolthub.com/cogni-dao/knowledge-operator`.
   * THE PUSH GATE. Unset → mirror disabled (healthy no-op). Granted only in the
   * production secret scope (MIRROR_PROD_ONLY_WRITER). */
  DOLTHUB_REMOTE_URL: optionalString,

  /** Dolt remote name (Dolt convention: "origin"). */
  SYNC_REMOTE_NAME: z.string().min(1).default("origin"),

  /** Branch to push. Single-branch mirror per the spec (main only). */
  SYNC_BRANCH: z.string().min(1).default("main"),

  /** Node label for logs/metrics. v0 wires only operator. */
  SYNC_NODE: z.string().min(1).default("operator"),

  /** Reconciliation interval (seconds). The push is idempotent + fast-forward; a
   * periodic re-push heals best-effort on-merge gaps (MIRROR_BEST_EFFORT_NO_RETRY). */
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(900),

  /** Run one reconciliation immediately on boot (default true). */
  SYNC_RUN_ON_START: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  /** Per-push timeout (ms) for the AbortSignal on the SQL push call. */
  SYNC_PUSH_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),

  /** Log level (default: info) */
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  /** Service name for logging (default: knowledge-sync) */
  SERVICE_NAME: z.string().default("knowledge-sync"),

  /** Health endpoint port (default: 9000) */
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
});

export type KnowledgeSyncConfig = z.infer<typeof EnvSchema>;

let _config: KnowledgeSyncConfig | null = null;

/**
 * Returns validated environment singleton. Parses process.env on first call,
 * caches result. Throws on invalid config with clear error messages.
 */
export function loadConfig(): KnowledgeSyncConfig {
  if (!_config) {
    const result = EnvSchema.safeParse(process.env);
    if (!result.success) {
      const errors = result.error.errors
        .map((e) => `  ${e.path.join(".")}: ${e.message}`)
        .join("\n");
      throw new Error(`Invalid environment configuration:\n${errors}`);
    }
    _config = result.data;
  }
  return _config;
}

/** Push is enabled only when both the source DB and the remote URL resolve. */
export function isMirrorEnabled(config: KnowledgeSyncConfig): boolean {
  return Boolean(config.DOLTGRES_URL && config.DOLTHUB_REMOTE_URL);
}
