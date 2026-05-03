// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/trading/position-actionability`
 * Purpose: Classify whether a ledger-backed Polymarket outcome token is still
 *   actionable for dashboard close flows.
 * Scope: Pure policy over injected position authorities. Does not read DB,
 *   construct executors, place CLOB orders, or know about HTTP routes.
 * Invariants:
 *   - DATA_API_IS_DISCOVERY_HINT — Polymarket Data API current value can
 *     refresh the read model, but Data API omission is not proof that a DB row
 *     is stale.
 *   - CTF_BALANCE_IS_EXIT_AUTHORITY — when Data API omits a ledger token, the
 *     wallet's CTF ERC-1155 balance decides whether a close attempt is
 *     possible; failed authority reads do not classify a position terminal.
 *   - CLOB_MIN_IS_SELLABILITY_FLOOR — non-zero balances below market minimum
 *     are classified as dust, not actionable close buttons.
 * Side-effects: injected reads only.
 * Links: nodes/poly/app/src/app/api/v1/poly/wallet/refresh/route.ts,
 *        nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts
 * @public
 */

export interface PositionActionabilityDataApiPosition {
  asset: string;
  size: number;
  currentValue: number;
}

export type PositionActionability =
  | {
      kind: "data_api_current";
      currentValueUsdc: number;
    }
  | {
      kind: "onchain_zero";
      shares: number;
    }
  | {
      kind: "onchain_dust";
      shares: number;
      minShares: number;
    }
  | {
      kind: "onchain_actionable";
      shares: number;
      minShares: number;
    }
  | {
      kind: "upstream_error";
      message: string;
    };

export interface ClassifyPositionActionabilityParams {
  tokenId: string;
  dataApiPositions: readonly PositionActionabilityDataApiPosition[];
  readOnchainShares: (tokenId: string) => Promise<number>;
  readMarketConstraints: (
    tokenId: string
  ) => Promise<{ minShares: number; minUsdcNotional?: number }>;
}

export async function classifyPositionActionability({
  tokenId,
  dataApiPositions,
  readOnchainShares,
  readMarketConstraints,
}: ClassifyPositionActionabilityParams): Promise<PositionActionability> {
  try {
    let constraints:
      | Awaited<
          ReturnType<
            ClassifyPositionActionabilityParams["readMarketConstraints"]
          >
        >
      | undefined;
    const getConstraints = async () => {
      constraints ??= await readMarketConstraints(tokenId);
      return constraints;
    };
    const currentPosition = dataApiPositions.find(
      (position) => position.asset === tokenId && position.size > 0
    );
    if (
      currentPosition !== undefined &&
      Number.isFinite(currentPosition.currentValue) &&
      currentPosition.currentValue > 0
    ) {
      const marketConstraints = await getConstraints();
      if (currentPosition.size >= marketConstraints.minShares) {
        return {
          kind: "data_api_current",
          currentValueUsdc: currentPosition.currentValue,
        };
      }
    }

    const shares = await readOnchainShares(tokenId);
    if (shares <= 0) {
      return { kind: "onchain_zero", shares };
    }

    const marketConstraints = await getConstraints();
    if (shares < marketConstraints.minShares) {
      return {
        kind: "onchain_dust",
        shares,
        minShares: marketConstraints.minShares,
      };
    }

    return {
      kind: "onchain_actionable",
      shares,
      minShares: marketConstraints.minShares,
    };
  } catch (err) {
    return {
      kind: "upstream_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
