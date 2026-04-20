// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_lib/poly/operator-extras`
 * Purpose: Single source of truth for the operator-only balance signals that can't be read
 *          via the public Data-API alone — USDC.e on-chain balance (Polygon RPC), POL gas
 *          (Polygon RPC), and open-order notional locked (Polymarket CLOB via the operator's
 *          API key held by `polyTradeBundle.capability`).
 * Scope: App-layer facade. Does not compute metrics, does not touch positions (that flows
 *        through the Data-API client in the feature service). Does not format for any contract.
 * Invariants:
 *   - PROCESS_SCOPED_COALESCE: each signal cached 30 s keyed by address.
 *   - OPERATOR_ONLY: callers must check `addr === POLY_PROTO_WALLET_ADDRESS` before invoking —
 *     this helper does not gate by address.
 *   - PARTIAL_FAILURE_NEVER_THROWS: individual upstream failures land in `errors[]` and the
 *     corresponding field is left `null`.
 * Side-effects: IO (Polygon RPC + Polymarket CLOB via operator's signed capability).
 * Links: docs/design/wallet-analysis-components.md, nodes/poly/app/src/app/api/v1/poly/wallet/balance/route.ts
 * @public
 */

import { createPublicClient, formatUnits, http, parseAbi } from "viem";
import { polygon } from "viem/chains";
import { getContainer } from "@/bootstrap/container";
import { coalesce } from "@/features/wallet-analysis/server/coalesce";
import { serverEnv } from "@/shared/env/server-env";

/** USDC.e on Polygon mainnet — Polymarket's quote token. */
const USDC_E_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);
const USDC_DECIMALS = 6;
const SLICE_TTL_MS = 30_000;

export type OperatorExtras = {
  /** USDC.e balance on Polygon (dollars, not atomic). `null` when RPC read fails. */
  available: number | null;
  /** Sum of `price * remaining_size_shares` across operator open orders. `null` when CLOB read fails. */
  locked: number | null;
  /** POL gas balance on Polygon. `null` when RPC read fails. */
  polGas: number | null;
  /** Non-fatal errors surfaced per source; empty on a clean read. */
  errors: string[];
};

/**
 * Fetch the three operator-only signals in parallel.
 * Only call when the requesting address is the pod's `POLY_PROTO_WALLET_ADDRESS`.
 */
export async function fetchOperatorExtras(
  operatorAddr: `0x${string}`
): Promise<OperatorExtras> {
  const errors: string[] = [];

  const [available, polGas] = await readPolygonBalances(operatorAddr, errors);
  const locked = await readLockedNotional(operatorAddr, errors);

  return { available, locked, polGas, errors };
}

async function readPolygonBalances(
  addr: `0x${string}`,
  errors: string[]
): Promise<[number | null, number | null]> {
  try {
    const env = serverEnv();
    const result = await coalesce(
      `operator-rpc:${addr.toLowerCase()}`,
      async () => {
        const client = createPublicClient({
          chain: polygon,
          transport: http(env.POLYGON_RPC_URL),
        });
        const [usdcRaw, polRaw] = await Promise.all([
          client.readContract({
            address: USDC_E_POLYGON,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [addr],
          }),
          client.getBalance({ address: addr }),
        ]);
        return {
          available: Number(formatUnits(usdcRaw, USDC_DECIMALS)),
          polGas: Number(formatUnits(polRaw, 18)),
        };
      },
      SLICE_TTL_MS
    );
    return [result.available, result.polGas];
  } catch (err) {
    errors.push(
      `polygon_rpc: ${err instanceof Error ? err.message : String(err)}`
    );
    return [null, null];
  }
}

async function readLockedNotional(
  addr: `0x${string}`,
  errors: string[]
): Promise<number | null> {
  try {
    const container = getContainer();
    const capability = container.polyTradeBundle?.capability;
    if (!capability) {
      errors.push("poly_capability_unconfigured");
      return null;
    }
    return await coalesce(
      `operator-locked:${addr.toLowerCase()}`,
      async () => {
        const orders = await capability.listOpenOrders();
        return orders.reduce((sum, o) => {
          const remaining =
            (o.original_size_shares ?? 0) - (o.filled_size_shares ?? 0);
          return sum + Math.max(remaining, 0) * (o.price ?? 0);
        }, 0);
      },
      SLICE_TTL_MS
    );
  } catch (err) {
    errors.push(
      `poly_open_orders: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
