// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/observability/health-probe`
 * Purpose: HTTP health probe — checks endpoint liveness with timeout and latency measurement.
 * Scope: Pure infrastructure utility. No business logic, no framework coupling.
 * Invariants: Always returns a result (never throws). Timeout defaults to 5s.
 * Side-effects: IO (HTTP)
 * @public
 */

export interface HealthProbeResult {
  url: string;
  status: "healthy" | "degraded" | "down";
  httpStatus: number | null;
  latencyMs: number | null;
}

export async function probeHealth(
  url: string,
  timeoutMs = 5000
): Promise<HealthProbeResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (res.ok)
      return { url, status: "healthy", httpStatus: res.status, latencyMs };
    if (res.status >= 500)
      return { url, status: "degraded", httpStatus: res.status, latencyMs };
    return { url, status: "down", httpStatus: res.status, latencyMs };
  } catch {
    return { url, status: "down", httpStatus: null, latencyMs: null };
  }
}
