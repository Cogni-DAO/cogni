// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/web3/wagmi.config`
 * Purpose: SSR-safe minimal wagmi config used ONLY for `cookieToInitialState`
 *   in the server `layout.tsx`. The actual wallet UI runs against the
 *   RainbowKit-tagged config in `./wagmi.config.client.ts`.
 * Scope: Server-importable. Built directly with `wagmi.createConfig` and bare
 *   `wagmi/connectors` so the server `layout.tsx` can import this module
 *   without poisoning the RSC server module graph (RainbowKit and its
 *   `/wallets` subpath are both flagged `"use client"`).
 * Invariants:
 *   - MUST NOT import from `@rainbow-me/rainbowkit` or `/wallets` — see PR #1119.
 *   - SSR enabled with cookieStorage; chains/transports MUST match
 *     `./wagmi.config.client.ts`.
 *   - WalletConnect projectId from env (optional).
 * Side-effects: none (config creation only).
 * Notes: Connectors here are rendered via the desktop "Installed" detection
 *   path in RainbowKit (which reads `injected()` directly). The mobile
 *   rendering path requires `rkDetails`-tagged connectors and only works via
 *   the client-only config sibling. See `./wagmi.config.client.ts` for the
 *   rationale and the curated wallet roster.
 * Links:
 *   - ./wagmi.config.client.ts (the connectors users actually see)
 *   - https://wagmi.sh/react/guides/ssr
 * @public
 */

import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";

import { clientEnv } from "@/shared/env/client";
import { CHAIN } from "./evm-wagmi";

const projectId = clientEnv().NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const connectors = [
  injected(),
  ...(projectId ? [walletConnect({ projectId, showQrModal: true })] : []),
];

/**
 * SSR-safe wagmi configuration consumed by `layout.tsx` for
 * `cookieToInitialState`. The client `Providers` tree uses
 * `wagmiConfigClient` from `./wagmi.config.client.ts` instead.
 */
export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors,
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
  transports: {
    [CHAIN.id]: http(),
  },
});
