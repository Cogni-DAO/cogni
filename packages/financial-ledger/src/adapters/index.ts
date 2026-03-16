// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/financial-ledger/adapters`
 * Purpose: Subpath export for adapter implementations. Isolated from main barrel to avoid pulling N-API into all importers.
 * Scope: Re-exports TigerBeetleAdapter only. Does not contain implementation logic.
 * Invariants: Importing `@cogni/financial-ledger` does NOT load this module.
 * Side-effects: IO (loads tigerbeetle-node N-API addon on import)
 * Links: docs/spec/packages-architecture.md (N-API Bundler Handling)
 * @public
 */

export {
  createTigerBeetleAdapter,
  TigerBeetleAdapter,
} from "./tigerbeetle.adapter.js";
