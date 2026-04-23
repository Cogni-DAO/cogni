// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/tests/polymarket-user-pnl`
 * Purpose: Unit tests for the Polymarket user P/L client backed by saved live fixtures.
 * Scope: Injected fetch mock only. Does not perform live network I/O or mutate state.
 * Invariants:
 *   - EMPTY_IS_HONEST: an upstream empty array stays empty.
 *   - QUERY_SHAPE_STABLE: requests keep `user_address`, `interval`, and `fidelity`.
 * Side-effects: none
 * Links: docs/research/fixtures/polymarket-user-pnl-week.json
 * @internal
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  PolymarketUserPnlClient,
  PolymarketUserPnlPointSchema,
} from "../src/adapters/polymarket/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WEEK_FIXTURE = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      "../../../docs/research/fixtures/polymarket-user-pnl-week.json"
    ),
    "utf8"
  )
) as unknown[];

const EMPTY_FIXTURE = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      "../../../docs/research/fixtures/polymarket-user-pnl-empty.json"
    ),
    "utf8"
  )
) as unknown[];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "ERR",
    json: async () => body,
  } as unknown as Response;
}

describe("PolymarketUserPnlClient.getUserPnl", () => {
  const wallet = "0x492442eab586f242b53bda933fd5de859c8a3782";

  it("parses the saved weekly fixture without throwing", () => {
    const parsed = WEEK_FIXTURE.map((row) =>
      PolymarketUserPnlPointSchema.parse(row)
    );
    expect(parsed.length).toBeGreaterThanOrEqual(2);
    expect(parsed[0]?.t).toBeTypeOf("number");
    expect(parsed[0]?.p).toBeTypeOf("number");
  });

  it("hits /user-pnl with user_address, interval, and fidelity", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(WEEK_FIXTURE));
    const client = new PolymarketUserPnlClient({ fetch: fetchImpl });

    const points = await client.getUserPnl(wallet, {
      interval: "1w",
      fidelity: "1d",
    });

    expect(points).toHaveLength(WEEK_FIXTURE.length);
    const call = fetchImpl.mock.calls[0]?.[0] as string;
    expect(call).toContain("/user-pnl");
    expect(call).toContain(`user_address=${wallet}`);
    expect(call).toContain("interval=1w");
    expect(call).toContain("fidelity=1d");
  });

  it("supports empty histories without fabricating points", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(EMPTY_FIXTURE));
    const client = new PolymarketUserPnlClient({ fetch: fetchImpl });

    await expect(
      client.getUserPnl(wallet, { interval: "1w", fidelity: "1d" })
    ).resolves.toEqual([]);
  });

  it("rejects malformed wallet addresses", async () => {
    const fetchImpl = vi.fn();
    const client = new PolymarketUserPnlClient({ fetch: fetchImpl });
    await expect(
      client.getUserPnl("not-a-wallet", { interval: "1w" })
    ).rejects.toThrow(/Invalid wallet/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a clear error on non-OK HTTP", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(null, false, 503));
    const client = new PolymarketUserPnlClient({ fetch: fetchImpl });
    await expect(
      client.getUserPnl(wallet, { interval: "1w", fidelity: "1d" })
    ).rejects.toThrow(/503/);
  });
});
