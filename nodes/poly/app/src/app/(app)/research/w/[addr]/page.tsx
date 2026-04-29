// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/w/[addr]/page`
 * Purpose: Dynamic per-wallet analysis page — auth-gated server shell that
 *          validates the addr param and hands rendering to the shared
 *          client-side wallet-analysis surface.
 * Scope: Server auth + param validation only. Client fetching/state live in
 *   `WalletAnalysisSurface`.
 * Invariants:
 *   - Any 0x address is accepted (lowercased). Bad addr → notFound().
 *   - Wallet-analysis data, including Polymarket P/L, is fetched by the shared
 *     client container so the page and drawer stay standardized.
 * Side-effects: none in this file.
 * Links: docs/design/wallet-analysis-components.md, nodes/poly/app/src/features/wallet-analysis/
 * @public
 */

import { PolyAddressSchema } from "@cogni/poly-node-contracts";
import { notFound, redirect } from "next/navigation";
import type { ReactElement } from "react";
import {
  CopyWalletButton,
  WalletAnalysisSurface,
} from "@/features/wallet-analysis";
import { getServerSessionUser } from "@/lib/auth/server";

type PageProps = {
  params: Promise<{ addr: string }>;
};

export default async function WalletAnalysisPage({
  params,
}: PageProps): Promise<ReactElement> {
  const user = await getServerSessionUser();
  if (!user) redirect("/");

  const { addr: rawAddr } = await params;
  const parsed = PolyAddressSchema.safeParse(rawAddr);
  if (!parsed.success) notFound();
  const addr = parsed.data;

  return (
    <main className="px-4 py-6 md:px-8 md:py-10">
      <WalletAnalysisSurface
        addr={addr}
        variant="page"
        size="default"
        headerActions={<CopyWalletButton addr={addr} />}
      />
    </main>
  );
}
