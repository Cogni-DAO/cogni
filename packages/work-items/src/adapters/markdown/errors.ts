// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/work-items/adapters/markdown/errors`
 * Purpose: Error types for the markdown work item adapter.
 * Scope: Error classes only. Does not perform I/O.
 * Invariants: Callers catch StaleRevisionError to retry after re-read.
 * Side-effects: none
 * Links: docs/spec/development-lifecycle.md
 * @public
 */

/** Thrown when expectedRevision does not match the current file's SHA-256. */
export class StaleRevisionError extends Error {
  override readonly name = "StaleRevisionError";
  constructor(
    readonly itemId: string,
    readonly expected: string,
    readonly actual: string
  ) {
    super(
      `Stale revision for ${itemId}: expected ${expected.slice(0, 8)}…, got ${actual.slice(0, 8)}…`
    );
  }
}

/** Thrown when a status transition is not allowed by the lifecycle spec. */
export class InvalidTransitionError extends Error {
  override readonly name = "InvalidTransitionError";
  constructor(
    readonly itemId: string,
    readonly from: string,
    readonly to: string
  ) {
    super(`Invalid status transition for ${itemId}: ${from} → ${to}`);
  }
}
