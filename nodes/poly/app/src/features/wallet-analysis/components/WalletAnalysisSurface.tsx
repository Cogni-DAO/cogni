// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/WalletAnalysisSurface`
 * Purpose: Client data container for the reusable wallet-analysis UI on both
 *          the page route and the side drawer.
 * Scope: Owns interval state + the shared `useWalletAnalysis` hook; renders
 *   `WalletAnalysisView`.
 * Invariants:
 *   - SINGLE_FETCH_SOURCE: this is the owner for wallet-analysis HTTP reads.
 *   - PAUSED_WHEN_DISABLED: no background fetches when `enabled=false`.
 * Side-effects: IO (via `useWalletAnalysis`).
 * Links: docs/design/wallet-analysis-components.md
 * @public
 */

"use client";

import type { PolyWalletOverviewInterval } from "@cogni/node-contracts";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { useWalletAnalysis } from "../client/use-wallet-analysis";
import type {
  WalletAnalysisSize,
  WalletAnalysisVariant,
} from "../types/wallet-analysis";
import { WalletAnalysisView } from "./WalletAnalysisView";

export type WalletAnalysisSurfaceProps = {
  addr: string;
  enabled?: boolean | undefined;
  variant?: WalletAnalysisVariant | undefined;
  size?: WalletAnalysisSize | undefined;
  /** Inline actions rendered next to the wallet's Polymarket / Polygonscan links. */
  headerActions?: ReactNode | undefined;
};

export function WalletAnalysisSurface({
  addr,
  enabled = true,
  variant = "page",
  size = "default",
  headerActions,
}: WalletAnalysisSurfaceProps): ReactElement {
  const [interval, setInterval] = useState<PolyWalletOverviewInterval>("ALL");
  const { data, isLoading } = useWalletAnalysis(addr, enabled, interval);

  return (
    <WalletAnalysisView
      data={data}
      variant={variant}
      size={size}
      isLoading={isLoading}
      capturedAt={new Date().toISOString().slice(0, 16).replace("T", " ")}
      pnlInterval={interval}
      onPnlIntervalChange={setInterval}
      headerActions={headerActions}
    />
  );
}
