// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-sync-service/redact`
 * Purpose: Redaction paths for sensitive data in logs.
 * Scope: Define paths to redact from log output. Does not implement redaction logic.
 * Invariants:
 *   - Only redact known secret-bearing keys (not generic "url").
 *   - DoltHub error bodies echo the Authorization header verbatim (verified
 *     2026-06-03 spike); never log raw HTTP response bodies — redact `token`/`authorization`.
 * Side-effects: none
 * Notes: Duplicated from src/shared/observability/server/redact.ts until @cogni/logging exists.
 * @internal
 */

export const REDACT_PATHS = [
  "password",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "apiKey",
  "api_key",
  "AUTH_SECRET",
  "DOLT_CREDS_JWK",
  "doltCredsJwk",
  "req.headers.authorization",
  "headers.authorization",
  "headers.cookie",
];
