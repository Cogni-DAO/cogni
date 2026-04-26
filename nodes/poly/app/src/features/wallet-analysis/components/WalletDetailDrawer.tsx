// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/WalletDetailDrawer`
 * Purpose: Side-sheet drawer that renders `WalletAnalysisView` for any 0x address. Opens instantly with skeletons; per-slice React Query data fills in as it lands. Used from the /research wallets table to keep users in flow instead of jumping pages.
 * Scope: Client component. Renders the shared `WalletAnalysisSurface`, which fetches the wallet-analysis slices. Includes a "Open in page →" link for users who want a shareable URL.
 * Invariants: SKELETON_FIRST — Sheet animates in immediately; molecules render their own loading skeletons via `WalletAnalysisView`'s `isLoading` prop. PAUSED_WHEN_CLOSED — `useWalletAnalysis` is `enabled=false` when the drawer is closed so we don't background-fetch for nothing.
 * Side-effects: IO (via `WalletAnalysisSurface`).
 * Links: docs/design/wallet-analysis-components.md, work/items/task.0344.wallet-row-drawer.md
 * @public
 */

"use client";

import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components";
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
        <SheetHeader className="sticky top-0 z-10 flex flex-row items-center justify-between gap-3 border-b bg-background/95 px-5 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SheetTitle className="font-semibold text-sm uppercase tracking-widest">
            Wallet analysis
          </SheetTitle>
          <div className="flex flex-1 items-center justify-end gap-3">
            {addr && <CopyWalletButton addr={addr} />}
            {addr && (
              <Link
                href={`/research/w/${addr.toLowerCase()}`}
                className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
                title="Open the full page (shareable URL)"
              >
                Open in page
                <ExternalLink className="size-3" aria-hidden />
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close drawer"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </SheetHeader>

        <div className="px-4 py-4 md:px-6 md:py-6">
          {addr ? (
            <WalletAnalysisSurface
              addr={addr}
              enabled={open}
              variant="page"
              size="default"
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
