// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/web3/wagmi.config.client`
 * Purpose: Client-only wagmi config built with RainbowKit's `connectorsForWallets`.
 *   This is what the `<WagmiProvider>` inside `providers.client.tsx` actually
 *   uses — it carries the `rkDetails` metadata that RainbowKit's modal
 *   (especially its mobile rendering path) needs to render wallet tiles.
 *
 *   The bare-connectors config in `./wagmi.config.ts` is kept around for the
 *   server `layout.tsx` to compute `cookieToInitialState` without poisoning
 *   the RSC server module graph (RainbowKit packages are `"use client"`).
 *   The server-computed `initialState` is passed to `<WagmiProvider>` here.
 * Scope: client only. MUST NOT be imported from server components / route
 *   handlers — `@rainbow-me/rainbowkit/wallets` carries `"use client"`.
 * Invariants:
 *   - `"use client"` directive at the top.
 *   - SSR enabled with cookieStorage; chains/transports match `./wagmi.config.ts`.
 *   - Curated wallet roster: MetaMask, Coinbase Wallet, WalletConnect, Rainbow,
 *     plus generic Injected fallback. Without the curated list, RainbowKit's
 *     mobile modal renders no wallet tiles at all (see PR #1119).
 *   - `projectId` is required when WalletConnect-deep-link-capable wallets
 *     (metaMask, walletConnect, rainbow) are in the list. If the env var is
 *     missing we degrade to injected-only (extension wallets only — mobile
 *     users will still see an empty modal in that mode).
 * Side-effects: none (config creation only).
 * Notes:
 *   - Connector IDs differ from `./wagmi.config.ts`'s `injected()`/`walletConnect()`,
 *     so a previously-connected user may not auto-reconnect after a refresh
 *     until they re-tap "Connect". The NextAuth session cookie is independent
 *     and survives refresh — sign-in state is unaffected. Follow-up: align
 *     connector IDs across both configs to restore seamless auto-reconnect.
 *   - Mobile sign-in flow this enables: tap Connect → tap MetaMask → Chrome /
 *     Safari deep-links to MetaMask app via `metamask://` → confirm Connect
 *     → confirm SIWE signature → return to app. WalletConnect deep-link tile
 *     does the same for any WC-compatible mobile wallet via QR or universal
 *     link.
 * Links:
 *   - https://www.rainbowkit.com/docs/custom-wallet-list
 *   - ./wagmi.config.ts (SSR-safe sibling)
 *   - app/providers.client.tsx (consumer)
 * @public
 */

"use client";

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { cookieStorage, createConfig, createStorage, http } from "wagmi";

import { clientEnv } from "@/shared/env/client";
import { CHAIN } from "./evm-wagmi";

const APP_NAME = "Cogni Operator";

const projectId = clientEnv().NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/**
 * RainbowKit-tagged connectors. `connectorsForWallets` attaches the `rkDetails`
 * metadata that the modal needs to render each wallet tile. Without this,
 * RainbowKit's mobile rendering path shows an empty modal even when injected
 * wallets are present.
 *
 * `projectId` is sentinel-stringified when missing because RainbowKit's
 * connector factories require a string. WalletConnect-based tiles will fail
 * at click time in that mode — surface this as an env-config error in
 * deployment rather than a silent degradation.
 */
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [
        metaMaskWallet,
        coinbaseWallet,
        walletConnectWallet,
        rainbowWallet,
        injectedWallet,
      ],
    },
  ],
  {
    appName: APP_NAME,
    projectId: projectId ?? "WALLETCONNECT_PROJECT_ID_MISSING",
  }
);

export const wagmiConfigClient = createConfig({
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
