// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/poly-backfill/walk`
 * Purpose: spike.5024 v0 — one-shot historical walker for a single Polymarket
 *   wallet's TRADE activity. Pages `/activity?type=TRADE` backwards in time
 *   via `end=<last_ts>` and writes NDJSON to disk. Read-only against
 *   data-api.polymarket.com; no DB writes, no live-tick coordination.
 * Scope: per-wallet trade-history dump. Does not call Gamma, does not
 *   reconstruct positions, does not seed `poly_trader_fills` (that's the
 *   loader, future work — design captured in
 *   docs/research/poly/backfill-spike-2026-05-05.md).
 * Invariants: dedupes adjacent-page boundary duplicates by transactionHash +
 *   asset + side; each page request bounded by `--max-pages`; writes one
 *   NDJSON line per ActivityEvent in walk order (newest first).
 * Side-effects: IO (unauthenticated HTTPS to data-api.polymarket.com; writes one NDJSON file per wallet under `--out`).
 * Links: docs/research/poly/backfill-spike-2026-05-05.md, work item spike.5024
 * @internal — experiment code, not shipped to production
 */

import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  type ActivityEvent,
  PolymarketDataApiClient,
} from "@cogni/poly-market-provider/adapters/polymarket";

const TARGETS: Record<string, string> = {
  RN1: "0x2005d16a84ceefa912d4e380cd32e7ff827875ea",
  swisstony: "0x204f72f35326db932158cba6adff0b9a1da95e14",
};

const PAGE_SIZE = 500;

interface Args {
  wallet: string;
  address: string;
  outDir: string;
  maxPages: number;
  startTs: number; // unix s; oldest boundary, walker stops when crossing
  endTs: number; // unix s; newest boundary, walker starts here
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const walletKey = get("wallet") ?? "RN1";
  const address = TARGETS[walletKey] ?? walletKey;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(
      `unknown --wallet ${walletKey}; pass a key from ${Object.keys(TARGETS).join(",")} or a 0x address`
    );
  }
  const now = Math.floor(Date.now() / 1000);
  return {
    wallet: walletKey,
    address,
    outDir: get("out") ?? "/tmp/poly-backfill",
    maxPages: Number(get("max-pages") ?? 5),
    startTs: Number(get("start") ?? 0),
    endTs: Number(get("end") ?? now),
  };
}

interface WalkSummary {
  pages: number;
  rowsRaw: number;
  rowsWritten: number;
  duplicatesSkipped: number;
  oldestTs: number | null;
  newestTs: number | null;
  walkMs: number;
}

async function walkOneWallet(
  client: PolymarketDataApiClient,
  args: Args
): Promise<WalkSummary> {
  mkdirSync(args.outDir, { recursive: true });
  const file = join(args.outDir, `${args.wallet}-fills.ndjson`);
  const out = createWriteStream(file, { encoding: "utf8" });

  const seen = new Set<string>();
  const summary: WalkSummary = {
    pages: 0,
    rowsRaw: 0,
    rowsWritten: 0,
    duplicatesSkipped: 0,
    oldestTs: null,
    newestTs: null,
    walkMs: 0,
  };

  const t0 = Date.now();
  let end = args.endTs;
  for (let page = 0; page < args.maxPages; page++) {
    const t1 = Date.now();
    const rows: ActivityEvent[] = await client.listActivity(args.address, {
      type: "TRADE",
      end,
      limit: PAGE_SIZE,
    });
    const t2 = Date.now();
    summary.pages++;
    summary.rowsRaw += rows.length;
    if (rows.length === 0) {
      console.log(
        `  [${args.wallet}] page ${page} empty (end=${end}) — wallet birth reached`
      );
      break;
    }
    let pageWritten = 0;
    let pageDup = 0;
    for (const r of rows) {
      const key = `${r.transactionHash}:${r.asset}:${r.side}`;
      if (seen.has(key)) {
        pageDup++;
        continue;
      }
      seen.add(key);
      out.write(`${JSON.stringify(r)}\n`);
      pageWritten++;
      if (summary.newestTs === null || r.timestamp > summary.newestTs)
        summary.newestTs = r.timestamp;
      if (summary.oldestTs === null || r.timestamp < summary.oldestTs)
        summary.oldestTs = r.timestamp;
    }
    summary.rowsWritten += pageWritten;
    summary.duplicatesSkipped += pageDup;
    const last = rows[rows.length - 1];
    const lastDate = new Date(last.timestamp * 1000).toISOString().slice(0, 19);
    console.log(
      `  [${args.wallet}] page ${page}: ${rows.length} rows in ${t2 - t1}ms (${pageWritten} new, ${pageDup} dup), last_ts=${last.timestamp} ${lastDate}Z`
    );
    if (last.timestamp <= args.startTs) {
      console.log(
        `  [${args.wallet}] crossed --start ${args.startTs}; stopping`
      );
      break;
    }
    end = last.timestamp;
  }
  summary.walkMs = Date.now() - t0;
  await new Promise<void>((res) => out.end(res));
  console.log(`  [${args.wallet}] wrote ${file}`);
  return summary;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(
    `\n[poly-backfill] wallet=${args.wallet} (${args.address})  end=${args.endTs}  start=${args.startTs}  maxPages=${args.maxPages}  out=${args.outDir}\n`
  );
  const client = new PolymarketDataApiClient({ timeoutMs: 15_000 });
  const summary = await walkOneWallet(client, args);
  console.log("\n[poly-backfill] done", JSON.stringify(summary, null, 2));
  if (summary.rowsWritten > 0 && summary.oldestTs && summary.newestTs) {
    const spanHrs = ((summary.newestTs - summary.oldestTs) / 3600).toFixed(2);
    const ratePerSec = (summary.rowsRaw / (summary.walkMs / 1000)).toFixed(0);
    console.log(
      `[poly-backfill] span ${spanHrs}h, throughput ${ratePerSec} rows/sec wall-clock, ${((summary.duplicatesSkipped / Math.max(summary.rowsRaw, 1)) * 100).toFixed(2)}% boundary-dup rate`
    );
  }
}

main().catch((err: unknown) => {
  console.error("[poly-backfill] unhandled:", err);
  process.exit(1);
});
