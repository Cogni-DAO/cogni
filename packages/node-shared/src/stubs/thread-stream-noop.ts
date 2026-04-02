// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-shared/stubs/thread-stream-noop`
 * Purpose: Noop stub for thread-stream — prevents Turbopack from following pino@7 → thread-stream@0.15 → test files requiring 'tape'/'tap'.
 * Scope: Client-safe stub only. Does NOT implement real thread-stream behavior.
 * Invariants: All methods are no-ops. Temporary containment until bug.0157 is resolved.
 * Side-effects: none
 * Links: work/items/bug.0157
 * @internal
 */

// biome-ignore lint/style/noDefaultExport: thread-stream's public API is a default export
export default class ThreadStream {
  write() {
    /* noop — client stub */
  }
  end() {
    /* noop — client stub */
  }
  flush() {
    /* noop — client stub */
  }
  destroy() {
    /* noop — client stub */
  }
}
