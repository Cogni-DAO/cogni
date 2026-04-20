// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@node-shared/tests/observability-context-factory`
 * Purpose: Verify createRequestContext binds userId into the child logger when a session is provided.
 * Scope: Unit test for factory.ts bindings. Does not exercise HTTP wrappers.
 * Invariants: userId present on child bindings iff session is provided (bug.0339).
 * Side-effects: none
 * Notes: pino is not imported — we inject a stub logger to assert the exact bindings passed to `.child()`.
 * Links: packages/node-shared/src/observability/context/factory.ts
 * @public
 */

import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { createRequestContext } from "../src/observability/context/factory";

function makeStubLogger(): {
  log: Logger;
  childSpy: ReturnType<typeof vi.fn>;
} {
  const childSpy = vi.fn();
  const child = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
  childSpy.mockReturnValue(child);
  const log = { child: childSpy } as unknown as Logger;
  return { log, childSpy };
}

const clock = { now: () => Date.now() };

describe("createRequestContext", () => {
  it("binds userId onto child logger when session is provided", () => {
    const { log: baseLog, childSpy } = makeStubLogger();
    const request = new Request("https://example.test/api/v1/thing", {
      method: "POST",
    });

    createRequestContext({ baseLog, clock }, request, {
      routeId: "thing.create",
      traceId: "trace-abc",
      session: {
        id: "user-123",
        walletAddress: null,
        displayName: null,
        avatarColor: null,
      },
    });

    expect(childSpy).toHaveBeenCalledTimes(1);
    expect(childSpy.mock.calls[0][0]).toMatchObject({
      route: "thing.create",
      method: "POST",
      traceId: "trace-abc",
      userId: "user-123",
    });
  });

  it("omits userId when session is absent", () => {
    const { log: baseLog, childSpy } = makeStubLogger();
    const request = new Request("https://example.test/api/v1/thing", {
      method: "GET",
    });

    createRequestContext({ baseLog, clock }, request, {
      routeId: "thing.list",
      traceId: "trace-xyz",
    });

    expect(childSpy).toHaveBeenCalledTimes(1);
    const bindings = childSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(bindings.userId).toBeUndefined();
    expect(bindings).toMatchObject({
      route: "thing.list",
      method: "GET",
      traceId: "trace-xyz",
    });
  });
});
