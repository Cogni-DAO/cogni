// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/features/wallet-analysis/market-outcome-service`
 * Purpose: Unit coverage for the condition-iterating market outcome tick
 *          using a stub CLOB client and a fake DB. Validates batch enumeration,
 *          dedupe, upsert call shape, and the per-call outbound log emit.
 * Scope: Pure JS — no testcontainers, no network.
 * Invariants: DEDUPE_BEFORE_UPSERT, BATCH_BOUNDED, OUTBOUND_PER_CALL_LOG.
 * Side-effects: none
 * Links: src/features/wallet-analysis/server/market-outcome-service.ts, work/items/task.5016
 * @internal
 */

import type { MarketResolutionInput } from "@cogni/poly-market-provider/analysis";
import { describe, expect, it, vi } from "vitest";
import { runMarketOutcomeTick } from "@/features/wallet-analysis/server/market-outcome-service";

type LogEntry = {
  level: "info" | "warn" | "error";
  payload: Record<string, unknown>;
  msg: string;
};

function recordingLogger() {
  const entries: LogEntry[] = [];
  const make = (
    base: Record<string, unknown> = {}
  ): {
    info: (p: Record<string, unknown>, m?: string) => void;
    warn: (p: Record<string, unknown>, m?: string) => void;
    error: (p: Record<string, unknown>, m?: string) => void;
    debug: (p: Record<string, unknown>, m?: string) => void;
    child: (extra: Record<string, unknown>) => ReturnType<typeof make>;
  } => ({
    info(p, m = "") {
      entries.push({ level: "info", payload: { ...base, ...p }, msg: m });
    },
    warn(p, m = "") {
      entries.push({ level: "warn", payload: { ...base, ...p }, msg: m });
    },
    error(p, m = "") {
      entries.push({ level: "error", payload: { ...base, ...p }, msg: m });
    },
    debug() {},
    child(extra) {
      return make({ ...base, ...extra });
    },
  });
  return { entries, logger: make() };
}

const noopMetrics = {
  incr: () => {},
  observeDurationMs: () => {},
};

type Candidate = { condition_id: string; token_id: string };

function fakeDb(candidates: Candidate[]) {
  const insertCalls: { values: unknown; onConflict: unknown }[] = [];
  const db = {
    async execute(_sql: unknown): Promise<Candidate[]> {
      return [...candidates];
    },
    insert(_table: unknown) {
      return {
        values(values: unknown) {
          return {
            onConflictDoUpdate(onConflict: unknown) {
              insertCalls.push({ values, onConflict });
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  return { db, insertCalls };
}

function resolution(
  closed: boolean,
  tokens: Array<{ token_id: string; winner: boolean }>
): MarketResolutionInput {
  return { closed, tokens };
}

describe("runMarketOutcomeTick", () => {
  it("polls each distinct condition once, dedupes upserts, emits outbound + tick_ok logs", async () => {
    const candidates: Candidate[] = [
      { condition_id: "cond-A", token_id: "tok-A1" },
      { condition_id: "cond-A", token_id: "tok-A2" },
      { condition_id: "cond-B", token_id: "tok-B1" },
    ];
    const { db, insertCalls } = fakeDb(candidates);
    const { entries, logger } = recordingLogger();

    const getMarketResolution = vi.fn(async (conditionId: string) => {
      if (conditionId === "cond-A")
        return resolution(true, [
          { token_id: "tok-A1", winner: true },
          { token_id: "tok-A2", winner: false },
        ]);
      return resolution(false, [{ token_id: "tok-B1", winner: false }]);
    });

    const result = await runMarketOutcomeTick({
      // biome-ignore lint/suspicious/noExplicitAny: fake DB shim
      db: db as any,
      clobClient: { getMarketResolution },
      logger,
      metrics: noopMetrics,
    });

    expect(result.conditions).toBe(3);
    expect(result.polled).toBe(2);
    expect(result.upserted).toBe(3);
    expect(result.errors).toBe(0);

    // Distinct conditions called once each
    expect(getMarketResolution).toHaveBeenCalledTimes(2);
    expect(getMarketResolution).toHaveBeenCalledWith("cond-A");
    expect(getMarketResolution).toHaveBeenCalledWith("cond-B");

    // Upsert called with three deduped rows mapped to outcome
    expect(insertCalls).toHaveLength(1);
    const inserted = insertCalls[0]?.values as ReadonlyArray<{
      conditionId: string;
      tokenId: string;
      outcome: string;
    }>;
    expect(inserted).toHaveLength(3);
    expect(
      inserted.find((r) => r.conditionId === "cond-A" && r.tokenId === "tok-A1")
        ?.outcome
    ).toBe("winner");
    expect(
      inserted.find((r) => r.conditionId === "cond-A" && r.tokenId === "tok-A2")
        ?.outcome
    ).toBe("loser");
    expect(
      inserted.find((r) => r.conditionId === "cond-B" && r.tokenId === "tok-B1")
        ?.outcome
    ).toBe("unknown");

    // One outbound event per upstream call
    const outbound = entries.filter(
      (e) => e.payload.event === "poly.market-outcome.outbound"
    );
    expect(outbound).toHaveLength(2);
    expect(
      outbound.every((e) => e.payload.component === "trader-market-outcome")
    ).toBe(true);

    // tick_ok with the result counters
    const tickOk = entries.find(
      (e) => e.payload.event === "poly.market-outcome.tick_ok"
    );
    expect(tickOk?.payload).toMatchObject({
      conditions: 3,
      polled: 2,
      upserted: 3,
      errors: 0,
    });
  });

  it("dedupes duplicate (condition,token) candidate rows to one upsert row", async () => {
    const candidates: Candidate[] = [
      { condition_id: "cond-X", token_id: "tok-X" },
      { condition_id: "cond-X", token_id: "tok-X" },
    ];
    const { db, insertCalls } = fakeDb(candidates);
    const { logger } = recordingLogger();

    const getMarketResolution = vi.fn(async () =>
      resolution(true, [{ token_id: "tok-X", winner: true }])
    );

    const result = await runMarketOutcomeTick({
      // biome-ignore lint/suspicious/noExplicitAny: fake DB shim
      db: db as any,
      clobClient: { getMarketResolution },
      logger,
      metrics: noopMetrics,
    });

    expect(result.upserted).toBe(1);
    const inserted = insertCalls[0]?.values as ReadonlyArray<unknown>;
    expect(inserted).toHaveLength(1);
  });

  it("returns zero counters with no candidates and skips upsert", async () => {
    const { db, insertCalls } = fakeDb([]);
    const { entries, logger } = recordingLogger();
    const getMarketResolution = vi.fn();

    const result = await runMarketOutcomeTick({
      // biome-ignore lint/suspicious/noExplicitAny: fake DB shim
      db: db as any,
      clobClient: { getMarketResolution },
      logger,
      metrics: noopMetrics,
    });

    expect(result).toEqual({
      conditions: 0,
      polled: 0,
      upserted: 0,
      errors: 0,
    });
    expect(getMarketResolution).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
    expect(
      entries.some((e) => e.payload.event === "poly.market-outcome.tick_ok")
    ).toBe(true);
  });

  it("counts upstream throws as errors, continues for remaining conditions", async () => {
    const candidates: Candidate[] = [
      { condition_id: "cond-bad", token_id: "tok-bad" },
      { condition_id: "cond-ok", token_id: "tok-ok" },
    ];
    const { db, insertCalls } = fakeDb(candidates);
    const { logger } = recordingLogger();

    const getMarketResolution = vi.fn(async (conditionId: string) => {
      if (conditionId === "cond-bad") throw new Error("boom");
      return resolution(true, [{ token_id: "tok-ok", winner: true }]);
    });

    const result = await runMarketOutcomeTick({
      // biome-ignore lint/suspicious/noExplicitAny: fake DB shim
      db: db as any,
      clobClient: { getMarketResolution },
      logger,
      metrics: noopMetrics,
    });

    expect(result.errors).toBe(1);
    expect(result.polled).toBe(1);
    expect(result.upserted).toBe(1);
    expect(insertCalls[0]?.values).toHaveLength(1);
  });
});
