// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/observability/logging/redact`
 * Purpose: Redaction paths for sensitive data in logs.
 * Scope: Define paths to redact from log output. Does not implement redaction logic.
 * Invariants: Only redact known secret-bearing keys (not generic "url").
 * Side-effects: none
 * Notes: Used by pino redact configuration during logger initialization.
 * Links: Imported by logger module; defines sensitive path patterns.
 * @public
 */

export const REDACT_PATHS = [
  // Auth & secrets
  "password",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "passphrase",
  "apiKey",
  "api_key",
  "POLY_SIGNATURE",
  "POLY_API_KEY",
  "POLY_PASSPHRASE",
  "AUTH_SECRET",
  // HTTP headers
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "headers.authorization",
  "headers.cookie",
  "headers.POLY_SIGNATURE",
  "headers.POLY_API_KEY",
  "headers.POLY_PASSPHRASE",
  "config.headers.authorization",
  "config.headers.POLY_SIGNATURE",
  "config.headers.POLY_API_KEY",
  "config.headers.POLY_PASSPHRASE",
  "err.config.headers.authorization",
  "err.config.headers.POLY_SIGNATURE",
  "err.config.headers.POLY_API_KEY",
  "err.config.headers.POLY_PASSPHRASE",
  "req.headers.poly_signature",
  "req.headers.poly_api_key",
  "req.headers.poly_passphrase",
  "headers.poly_signature",
  "headers.poly_api_key",
  "headers.poly_passphrase",
  "config.headers.poly_signature",
  "config.headers.poly_api_key",
  "config.headers.poly_passphrase",
  "err.config.headers.poly_signature",
  "err.config.headers.poly_api_key",
  "err.config.headers.poly_passphrase",
  "creds.secret",
  "creds.passphrase",
  "creds.key",
  // Wallet/crypto
  "privateKey",
  "mnemonic",
  "seed",
];
