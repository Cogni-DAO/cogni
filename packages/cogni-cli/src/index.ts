// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cli`
 * Purpose: Programmatic re-exports for the cogni dev CLI internals (used by tests).
 * Scope: Library entry. Does not contain CLI dispatch logic — that lives in `src/cli.ts`.
 * Invariants: Only re-exports pure helpers; spawning subprocesses is gated behind the CLI command.
 * Side-effects: none
 * Links: src/cli.ts, src/dev/runtime.ts
 * @public
 */

export type { Runtime, RuntimeKind } from "./dev/runtime.js";
export { detectRuntimes } from "./dev/runtime.js";
export { parseTunnelUrl } from "./dev/tunnel.js";
