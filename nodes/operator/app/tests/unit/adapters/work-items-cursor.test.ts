// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/work-items-cursor`
 * Purpose: Unit tests for the opaque cursor codec used by Doltgres work_items pagination.
 * Scope: Pure encode/decode round-trip, error cases. No IO.
 * Side-effects: none
 * Links: bug.5162, src/adapters/server/db/doltgres/work-items-cursor.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  decodeCursor,
  encodeCursor,
  type WorkItemCursor,
} from "@/adapters/server/db/doltgres/work-items-cursor";

describe("work-items-cursor codec", () => {
  it("round-trips a fully populated cursor", () => {
    const c: WorkItemCursor = {
      p: 1,
      r: 5,
      ts: "2026-04-30T12:00:00.000Z",
      id: "task.5042",
    };
    const decoded = decodeCursor(encodeCursor(c));
    expect(decoded).toEqual(c);
  });

  it("round-trips a cursor with null priority/rank", () => {
    const c: WorkItemCursor = {
      p: null,
      r: null,
      ts: "2026-04-30T12:00:00.000Z",
      id: "bug.5162",
    };
    const decoded = decodeCursor(encodeCursor(c));
    expect(decoded).toEqual(c);
  });

  it("encoded cursor uses base64url alphabet (no +, /, =)", () => {
    const encoded = encodeCursor({
      p: 1,
      r: 1,
      ts: "2026-04-30T12:00:00.000Z",
      id: "task.5042",
    });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("rejects malformed input", () => {
    expect(() => decodeCursor("!!!not-base64!!!")).toThrow();
    expect(() => decodeCursor("aGVsbG8")).toThrow(); // valid base64, not JSON
  });

  it("rejects shape-mismatched JSON", () => {
    // base64url("{}")
    expect(() => decodeCursor("e30")).toThrow();
  });
});
