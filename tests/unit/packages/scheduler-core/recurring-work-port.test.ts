// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/packages/scheduler-core/recurring-work-port`
 * Purpose: Contract test for the RecurringWorkPort seam — proves the 2-method port is
 *   implementable, that a repo-spec-shaped NodeScheduleEntry flows through `schedule()`
 *   unchanged, and that `cancel()` is idempotent. Guards the seam both impls (cron, Temporal) bind to.
 * Scope: Pure type/contract test with an in-memory fake; no Temporal, no cron, no I/O.
 * Invariants: schedule() accepts the NodeScheduleEntry shape and returns a stable handle;
 *   cancel() is idempotent.
 * Side-effects: none
 * Links: packages/scheduler-core/src/ports/recurring-work.port.ts
 * @public
 */

import type {
  NodeScheduleEntry,
  RecurringWorkInput,
  RecurringWorkPort,
} from "@cogni/scheduler-core";
import { describe, expect, it } from "vitest";

/** Minimal in-memory fake — the smallest valid RecurringWorkPort implementation. */
function createInMemoryRecurringWork(): RecurringWorkPort & {
  readonly active: ReadonlyMap<string, RecurringWorkInput>;
} {
  const active = new Map<string, RecurringWorkInput>();
  return {
    active,
    async schedule(input) {
      const scheduleId = `node-task:${input.nodeId}:${input.id}`;
      active.set(scheduleId, input); // idempotent on the logical schedule
      return { scheduleId };
    },
    async cancel(scheduleId) {
      active.delete(scheduleId); // idempotent no-op if absent
    },
  };
}

const entry: NodeScheduleEntry = {
  id: "metrics-ingest",
  nodeId: "beacon",
  cron: "*/15 * * * *",
  timezone: "UTC",
  kind: "http-dispatch",
  route: "/api/internal/ops/metrics-ingest",
  payload: { window: "15m" },
};

describe("RecurringWorkPort", () => {
  it("schedule() accepts a NodeScheduleEntry and returns a stable handle", async () => {
    const port = createInMemoryRecurringWork();
    const { scheduleId } = await port.schedule(entry);

    expect(scheduleId).toBe("node-task:beacon:metrics-ingest");
    expect(port.active.get(scheduleId)).toEqual(entry);
  });

  it("schedule() is idempotent on the logical schedule (nodeId + id)", async () => {
    const port = createInMemoryRecurringWork();
    const first = await port.schedule(entry);
    const second = await port.schedule({
      ...entry,
      payload: { window: "30m" },
    });

    expect(second.scheduleId).toBe(first.scheduleId);
    expect(port.active.size).toBe(1);
    expect(port.active.get(first.scheduleId)?.payload).toEqual({
      window: "30m",
    });
  });

  it("cancel() removes the schedule and is a no-op when absent", async () => {
    const port = createInMemoryRecurringWork();
    const { scheduleId } = await port.schedule(entry);

    await port.cancel(scheduleId);
    expect(port.active.has(scheduleId)).toBe(false);

    await expect(port.cancel(scheduleId)).resolves.toBeUndefined();
    await expect(
      port.cancel("node-task:beacon:never-existed")
    ).resolves.toBeUndefined();
  });
});
