// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/poly-backfill/pnl-backfill`
 * Purpose: spike.5024 v0 — backfill `poly_trader_user_pnl_points` for one
 *   wallet by calling Polymarket's `user-pnl-api` endpoint at both fidelities
 *   the live tick uses (`1h` over `interval=1w`, `1d` over `interval=max`).
 *   Mirrors `fetchAndPersistTradingWalletPnlHistory`'s INSERT shape and
 *   ON CONFLICT DO UPDATE semantics so this loader is the same write path
 *   the live observation tick uses.
 * Scope: HTTP fetch + Postgres upsert; does not seed `poly_market_outcomes`, does not touch `poly_trader_fills`, does not manage SSH tunnels (caller sets `DATABASE_URL_POLY`).
 *   Looks up the trader_wallet_id by wallet_address; refuses to run without --apply + DATABASE_URL_POLY.
 *   Single-shot per wallet — user-pnl-api returns the full lifetime series
 *   in one response; no pagination required.
 * Invariants: idempotent on `(trader_wallet_id, fidelity, ts)`; dedupe by
 *   timestamp before insert (bug.5011 — upstream returns the current bucket
 *   twice during the active period and PG rejects same-target ON CONFLICT
 *   batches).
 * Side-effects: IO (HTTPS to user-pnl-api.polymarket.com; postgres-js INSERT
 *   to a poly DB).
 * Links: docs/research/poly/backfill-spike-2026-05-05.md, work item spike.5024
 * @internal — experiment code, not shipped to production
 */

import postgres from "postgres";

const USER_PNL_BASE = "https://user-pnl-api.polymarket.com";

interface Args {
  walletAddress: string;
  apply: boolean;
  dsn: string | undefined;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const walletAddress = get("wallet-address");
  const apply = argv.includes("--apply");
  const dsn = process.env.DATABASE_URL_POLY;
  if (!walletAddress) {
    throw new Error(
      "usage: pnl-backfill --wallet-address 0x... [--apply]\n" +
        "  set DATABASE_URL_POLY env var when --apply is passed"
    );
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    throw new Error(`invalid --wallet-address: ${walletAddress}`);
  }
  return { walletAddress, apply, dsn };
}

interface PnlPoint {
  t: number;
  p: number;
}

async function fetchUserPnl(
  wallet: string,
  interval: "1w" | "max",
  fidelity: "1h" | "1d"
): Promise<PnlPoint[]> {
  const url = new URL("/user-pnl", USER_PNL_BASE);
  url.searchParams.set("user_address", wallet);
  url.searchParams.set("interval", interval);
  url.searchParams.set("fidelity", fidelity);
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(
      `user-pnl-api ${resp.status} for ${wallet}/${interval}/${fidelity}`
    );
  }
  return (await resp.json()) as PnlPoint[];
}

function dedupeByTimestamp(points: PnlPoint[]): PnlPoint[] {
  const seen = new Set<number>();
  const out: PnlPoint[] = [];
  for (const p of points) {
    if (seen.has(p.t)) continue;
    seen.add(p.t);
    out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const lower = args.walletAddress.toLowerCase();
  console.log(
    `[pnl-backfill] wallet=${args.walletAddress} apply=${args.apply}`
  );

  // Fetch both fidelities up front so dry-run can show what would be written.
  // 1h × interval=max — the live tick only fetches interval=1w (~7 d) at this
  // fidelity for retention reasons; we need the full lifetime of hourly points
  // for in-depth historical research. Empirically returns ~6 K points / 270 d.
  // 1d × interval=max — live tick already does this, but re-fetching is cheap
  // and the upsert is idempotent on (trader_wallet_id, fidelity, ts).
  const t0 = Date.now();
  const [hourPoints, dayPoints] = await Promise.all([
    fetchUserPnl(lower, "max", "1h"),
    fetchUserPnl(lower, "max", "1d"),
  ]);
  console.log(
    `[pnl-backfill] fetched in ${Date.now() - t0}ms — 1h:${hourPoints.length} pts, 1d:${dayPoints.length} pts`
  );
  if (dayPoints.length > 0) {
    const first = new Date(dayPoints[0].t * 1_000).toISOString().slice(0, 10);
    const last = new Date(dayPoints[dayPoints.length - 1].t * 1_000)
      .toISOString()
      .slice(0, 10);
    console.log(
      `[pnl-backfill] 1d span: ${first} -> ${last}  | last p=$${dayPoints[dayPoints.length - 1].p.toFixed(2)}`
    );
  }

  if (!args.apply) {
    console.log("[pnl-backfill] dry-run (no --apply); first 3 1d points:");
    for (const p of dayPoints.slice(0, 3)) {
      console.log(
        `  ts=${p.t} (${new Date(p.t * 1_000).toISOString()}) p=${p.p.toFixed(2)}`
      );
    }
    return;
  }

  if (!args.dsn) throw new Error("--apply requires DATABASE_URL_POLY env var");
  const sql = postgres(args.dsn, { ssl: false, idle_timeout: 10, max: 1 });
  try {
    const wallets = await sql`
      SELECT id::text AS id, label
      FROM poly_trader_wallets
      WHERE wallet_address = ${lower}
      LIMIT 1
    `;
    if (wallets.length === 0) {
      throw new Error(
        `wallet not found in poly_trader_wallets: ${args.walletAddress}`
      );
    }
    const traderWalletId = wallets[0].id as string;
    const label = wallets[0].label as string;
    console.log(`[pnl-backfill] target wallet: ${label} (${traderWalletId})`);

    let inserted = 0;
    for (const [fidelity, points] of [
      ["1h", hourPoints] as const,
      ["1d", dayPoints] as const,
    ]) {
      const deduped = dedupeByTimestamp(points);
      if (deduped.length === 0) {
        console.log(`  [${fidelity}] no points to insert`);
        continue;
      }
      const rows = deduped.map((p) => ({
        trader_wallet_id: traderWalletId,
        fidelity,
        ts: new Date(p.t * 1_000),
        pnl_usdc: p.p.toFixed(8),
      }));
      const t = Date.now();
      // Mirrors trading-wallet-overview-service.ts:fetchAndPersistTradingWalletPnlHistory
      await sql`
        INSERT INTO poly_trader_user_pnl_points ${sql(rows)}
        ON CONFLICT (trader_wallet_id, fidelity, ts) DO UPDATE
          SET pnl_usdc = excluded.pnl_usdc,
              observed_at = now()
      `;
      inserted += rows.length;
      console.log(
        `  [${fidelity}] upserted ${rows.length} rows in ${Date.now() - t}ms`
      );
    }
    console.log(`[pnl-backfill] done — ${inserted} total rows upserted`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error("[pnl-backfill] unhandled:", err);
  process.exit(1);
});
