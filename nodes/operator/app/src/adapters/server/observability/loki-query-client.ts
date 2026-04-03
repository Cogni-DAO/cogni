// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/observability/loki-query-client`
 * Purpose: Grafana Cloud Loki query client — executes LogQL queries over HTTP.
 * Scope: Infrastructure utility. Constructor injection for credentials. No env access.
 * Invariants: Always returns a result (never throws). Timeout defaults to 8s.
 * Side-effects: IO (HTTP to Loki API)
 * @public
 */

export interface LokiQueryConfig {
  /** Base URL or push URL (strips /loki/api/v1/push suffix automatically). */
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs?: number;
}

export interface LokiLogEntry {
  timestamp: string;
  line: string;
  parsed: Record<string, string> | null;
}

export class LokiQueryClient {
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly timeoutMs: number;

  constructor(config: LokiQueryConfig) {
    this.baseUrl = config.baseUrl.replace(/\/loki\/api\/v1\/push\/?$/, "");
    this.auth = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  async queryRange(
    query: string,
    startMs: number,
    endMs: number,
    limit = 50
  ): Promise<LokiLogEntry[]> {
    try {
      const url = new URL(`${this.baseUrl}/loki/api/v1/query_range`);
      url.searchParams.set("query", query);
      url.searchParams.set("start", String(startMs * 1_000_000));
      url.searchParams.set("end", String(endMs * 1_000_000));
      url.searchParams.set("limit", String(limit));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const res = await fetch(url.toString(), {
        headers: { Authorization: this.auth },
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeout);
      if (!res.ok) return [];

      const data = (await res.json()) as {
        data: { result: Array<{ values: Array<[string, string]> }> };
      };

      const entries: LokiLogEntry[] = [];
      for (const stream of data.data.result) {
        for (const [ts, line] of stream.values) {
          let parsed: Record<string, string> | null = null;
          try {
            parsed = JSON.parse(line) as Record<string, string>;
          } catch {
            /* raw line */
          }
          entries.push({
            timestamp: new Date(Number(ts) / 1_000_000).toISOString(),
            line,
            parsed,
          });
        }
      }
      return entries;
    } catch {
      return [];
    }
  }
}
