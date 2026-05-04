---
id: handoff.poly-dashboard-positions-hang
type: handoff
status: open
created: 2026-04-30
updated: 2026-04-30
branch: docs/poly-v1-v2-clarification
---

# Handoff — poly dashboard positions don't load

> Cold-start handoff. Read top-to-bottom; you have everything you need.

## Symptom

User reports the Polymarket dashboard's positions table doesn't load. Other UI sections render. The positions section is empty / spinner-stuck.

Affected user: tenant `777dedd4-b49e-443f-a1e7-23c2e77468ef`, funder `0x9A9e7276b3C4d6E7c9a866EB6FEB8CFaB82C160A`. Reproduces on candidate-a.

## What's already mapped

### UI → API path

```
ExecutionActivityCard (client component)
  └─ useQuery(queryKey=['execution'], queryFn=fetchExecution, refetchInterval=30s)
      └─ fetchExecution()  →  GET /api/v1/poly/wallet/execution
          (file: nodes/poly/app/src/app/(app)/dashboard/_api/fetchExecution.ts)
```

PositionsTable is a pure renderer — it does NOT fetch. It receives `WalletPosition[]` from `executionData.live_positions` (or `closed_positions`).

Files (read these first):

- `nodes/poly/app/src/app/(app)/dashboard/_components/ExecutionActivityCard.tsx`
- `nodes/poly/app/src/app/(app)/dashboard/_api/fetchExecution.ts`
- `nodes/poly/app/src/app/api/v1/poly/wallet/execution/route.ts`
- `nodes/poly/app/src/app/(app)/_components/positions-table/PositionsTable.tsx`

### Server-side handler

`/api/v1/poly/wallet/execution` is per-tenant. It calls Polymarket Data API for trades + positions, plus public CLOB for price snapshots, then merges. The handler has its own log emit `route="poly.wallet.execution"` + `msg="poly.wallet.execution"`.

## Smoking gun in Loki

Sample request from candidate-a, reqId `256ff9f2-3bdc-4300-91d5-2a7ed30244a0` (2026-04-30 16:35Z):

```
16:35:57.211Z  msg="request received"        route="poly.wallet.execution"
16:35:58.437Z  msg="poly.wallet.execution"   (handler internal emit, ~1.2s later)
                                             billing_account_id=777dedd4...
                                             funder_address=0x9A9e7276...
─── NO request complete log ───
```

A healthy request emits `msg="request complete"` with `status` + `durationMs` at the end. **It's missing.** The handler doesn't return a response. The browser's fetch hangs until tanstack-query times it out, leaving the table empty.

Sample LogQL to reproduce:

```logql
{namespace="cogni-candidate-a", service="app"} | json | route="poly.wallet.execution"
```

Then take a recent reqId and search by it — you'll see receive + internal emit but no complete.

## Likely root causes (ranked)

1. **Polymarket Data API call hangs** — the `/positions` endpoint hangs or returns unexpected data, and the handler awaits it without a `Promise.race(timeout)`. Confirm by reading the route's outbound HTTP timeline in `route.ts`.
2. **Chain read hangs** (price snapshot via `publicClient`) — same pattern. Look for `await client.multicall` or `readContract` without timeout.
3. **Unhandled rejection inside the handler** — promise rejected, never sent response, the route logger's wrapping (`wrapRouteHandlerWithLogging`) may have a bug where rejection swallows the completion log.
4. **Schema mismatch on response building** — Zod parse throws inside the route, falls into a broken catch, caller hangs.

## Investigation recipe (next agent)

1. **Read `nodes/poly/app/src/app/api/v1/poly/wallet/execution/route.ts` end-to-end.** Map every `await`. Identify which is the last to start before the handler should return.

2. **Repro live:** hit `https://poly-test.cognidao.org/api/v1/poly/wallet/execution` with Derek's storageState (or as your own session). Time the response. If it hangs > 30s, the bug is server-side, not UI-cache.

   ```bash
   playwright-cli -s=qa state-load .local-auth/candidate-a-poly.storageState.json
   playwright-cli -s=qa open https://poly-test.cognidao.org/api/v1/poly/wallet/execution
   playwright-cli -s=qa network    # confirm request hung / response time
   ```

3. **Loki: find any reqId that DID complete recently.** If none ever complete for this tenant, it's deterministic. If some do, look for shape differences (specific market, specific position size, etc.).

   ```logql
   {namespace="cogni-candidate-a", service="app"} | json | route="poly.wallet.execution" | msg="request complete"
   ```

4. **Search for outbound calls during a hung request.** The handler does Polymarket Data API + CLOB calls. If `data-api.polymarket.com` returns a degraded response on this tenant's funder (e.g., the wallet now has 49 positions including weird zero-sized rows), parsing may explode.

5. **Check for unhandled rejections.** Search Loki for `level="error"` emitted by the same pod near the hung reqId.

   ```logql
   {namespace="cogni-candidate-a", pod=~"poly-node-app-.*"} | json | level="50"
   ```

## What I tested vs what I didn't

- ✅ Confirmed UI → fetch → API route mapping is correct (above)
- ✅ Confirmed reqId hangs at server (no `request complete` in Loki)
- ✅ Confirmed UI cache pattern matches an indefinitely-pending fetch (tanstack-query keeps showing stale/empty state)
- ❌ Did NOT read the full route.ts implementation — that's where the next agent should start
- ❌ Did NOT live-reproduce via Playwright
- ❌ Did NOT correlate with Polymarket Data API status

## Adjacent context worth knowing

- The same tenant's wallet is at `0x9A9e7276...`, holds 49 positions per Data API (mix of V1 and V2 vintages, mostly zero-value resolved-loser dust).
- Earlier today (2026-04-30 ~05:25Z) we wiped 46,989 stale `error` rows from `poly_copy_trade_fills` for this tenant. That cleared cap-blocked phantom intent, didn't touch positions data.
- bug.0428 is in merge queue (PR #1145) — does NOT touch this route. The dashboard issue is orthogonal.
- `docs/spec/poly-collateral-currency.md` was updated on this branch with V1/V2 vintage clarification — same handoff branch, but unrelated change.

## Definition of done

- Reproducible root cause for `/api/v1/poly/wallet/execution` hang (which await blocks, why)
- Fix: timeout or graceful degradation so dashboard renders even when one upstream stalls
- Loki shows `request complete status=200` (or `status=503` partial) for the user's polls
- Dashboard positions table renders Derek's 3 known open positions (Cremonese, Sharipov, Broady)

## Pointers

- `docs/guides/agent-api-validation.md` — agent-first API exercise patterns
- `scripts/loki-query.sh` — shell Loki helper if MCP disconnected
- `.local-auth/candidate-a-poly.storageState.json` — captured Playwright auth for this env
