// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/port/observability`
 * Purpose: Minimal LoggerPort + MetricsPort interfaces for Run-phase adapters, structurally compatible with pino and prom-client so real instances can be passed in directly without the package importing either.
 * Scope: Port + no-op default sinks only. Adapters receive sinks via constructor; node apps wire real pino/prom at the boundary. Does not import pino/prom, does not read env, does not define metric schemas.
 * Invariants: PURE_LIBRARY — no env vars, no singletons, no side effects on import.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 — observability)
 * @public
 */

/**
 * Structured-log sink. Shape is deliberately a subset of `pino.Logger` so a
 * real pino instance can be passed in directly. Adapters MUST NOT assume any
 * method beyond this surface.
 */
export interface LoggerPort {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  child(bindings: Record<string, unknown>): LoggerPort;
}

/**
 * Metrics sink. Shape captures the two emission patterns adapters actually
 * need: increment-a-counter and observe-a-duration. Labels are a flat
 * key→string map (prom-client enforces stringified label values anyway).
 *
 * Callers can adapt a `prom-client` `Counter`/`Histogram` behind this in a
 * few lines; tests use the in-memory `createRecordingMetrics()` fake below.
 */
export interface MetricsPort {
  /** Increment a counter by 1 with the given label set. */
  incr(name: string, labels?: Record<string, string>): void;
  /** Record a duration observation (milliseconds) with the given label set. */
  observeDurationMs(
    name: string,
    ms: number,
    labels?: Record<string, string>
  ): void;
}

/** No-op logger — used as the default when a caller passes nothing. */
export const noopLogger: LoggerPort = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger;
  },
};

/** No-op metrics sink — used as the default when a caller passes nothing. */
export const noopMetrics: MetricsPort = {
  incr() {},
  observeDurationMs() {},
};

/**
 * In-memory recording sink for tests. Captures every emission so specs can
 * assert on `name`, `labels`, and `value`. Intentionally exported — any
 * adapter test in this package can depend on it without rebuilding.
 */
export interface RecordedCounter {
  kind: "counter";
  name: string;
  labels: Record<string, string>;
}
export interface RecordedDuration {
  kind: "duration";
  name: string;
  ms: number;
  labels: Record<string, string>;
}
export type RecordedMetric = RecordedCounter | RecordedDuration;

export interface RecordingMetricsPort extends MetricsPort {
  readonly emissions: RecordedMetric[];
  countsByName(name: string): number;
  durations(name: string): number[];
}

export function createRecordingMetrics(): RecordingMetricsPort {
  const emissions: RecordedMetric[] = [];
  return {
    emissions,
    incr(name, labels = {}) {
      emissions.push({ kind: "counter", name, labels });
    },
    observeDurationMs(name, ms, labels = {}) {
      emissions.push({ kind: "duration", name, ms, labels });
    },
    countsByName(name) {
      return emissions.filter((e) => e.kind === "counter" && e.name === name)
        .length;
    },
    durations(name) {
      return emissions
        .filter(
          (e): e is RecordedDuration => e.kind === "duration" && e.name === name
        )
        .map((e) => e.ms);
    },
  };
}
