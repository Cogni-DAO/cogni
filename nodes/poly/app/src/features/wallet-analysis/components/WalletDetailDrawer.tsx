// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/WalletDetailDrawer`
 * Purpose: Side-sheet drawer that renders `WalletAnalysisView` for any 0x address. Opens instantly with skeletons; per-slice React Query data fills in as it lands. Used from the /research wallets table to keep users in flow instead of jumping pages.
 * Scope: Client component. Renders the shared `WalletAnalysisSurface`, which fetches the wallet-analysis slices. Injects a "Copy wallet" toggle and an "Open in page" link as inline `headerActions` next to the wallet's Polymarket / Polygonscan links — the drawer has no chrome of its own beyond the Sheet's auto-rendered close button.
 * Invariants: SKELETON_FIRST — Sheet animates in immediately; molecules render their own loading skeletons via `WalletAnalysisView`'s `isLoading` prop. PAUSED_WHEN_CLOSED — `useWalletAnalysis` is `enabled=false` when the drawer is closed so we don't background-fetch for nothing.
 * Side-effects: IO (via `WalletAnalysisSurface`).
 * Links: docs/design/wallet-analysis-components.md, work/items/task.0344.wallet-row-drawer.md
 * @public
 */

"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";

import { Sheet, SheetContent, SheetTitle } from "@/components";
import { CopyWalletButton } from "./CopyWalletButton";
import { WalletAnalysisSurface } from "./WalletAnalysisSurface";

export type WalletDetailDrawerProps = {
  /** 0x address to render. `null` keeps the sheet closed. */
  addr: string | null;
  /** Controlled open state — driven by the table's selected row. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function WalletDetailDrawer({
  addr,
  open,
  onOpenChange,
}: WalletDetailDrawerProps): ReactElement {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-3xl"
      >
        <SheetTitle className="sr-only">Wallet analysis</SheetTitle>

        <div className="px-4 py-4 md:px-6 md:py-6">
          {addr ? (
            <WalletAnalysisSurface
              addr={addr}
              enabled={open}
              variant="page"
              size="default"
              headerActions={
                <>
                  <CopyWalletButton addr={addr} />
                  <Link
                    href={`/research/w/${addr.toLowerCase()}`}
                    className="inline-flex items-center gap-1 text-primary text-xs underline-offset-2 hover:underline"
                    title="Open the full page (shareable URL)"
                  >
                    Open in page
                    <ExternalLink className="size-3" aria-hidden />
                  </Link>
                </>
              }
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
