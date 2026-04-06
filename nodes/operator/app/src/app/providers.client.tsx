// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/providers.client`
 * Purpose: Client boundary composing platform providers with node-local wagmiConfig.
 * Scope: Auth + Query from @cogni/node-app, wallet composition inline. Does not own provider logic.
 * Invariants: WagmiProvider must be composed in app-local code — transpilePackages breaks wagmi SSR (indexedDB not defined).
 * Side-effects: none
 * Links: packages/node-app/src/providers/, src/shared/web3/wagmi.config.ts
 * @public
 */

"use client";

import {
  AuthProvider,
  createAppDarkTheme,
  createAppLightTheme,
  QueryProvider,
} from "@cogni/node-app/providers";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { RainbowKitSiweNextAuthProvider } from "@rainbow-me/rainbowkit-siwe-next-auth";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/shared/web3/wagmi.config";

function RainbowKitThemeProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const theme = useMemo(
    () =>
      mounted && resolvedTheme === "light"
        ? createAppLightTheme()
        : createAppDarkTheme(),
    [mounted, resolvedTheme]
  );

  return <RainbowKitProvider theme={theme}>{children}</RainbowKitProvider>;
}

export function Providers({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <AuthProvider>
      <QueryProvider>
        <WagmiProvider config={wagmiConfig}>
          <RainbowKitSiweNextAuthProvider
            getSiweMessageOptions={() => ({
              statement: "Sign in with Ethereum to the app.",
            })}
          >
            <RainbowKitThemeProvider>{children}</RainbowKitThemeProvider>
          </RainbowKitSiweNextAuthProvider>
        </WagmiProvider>
      </QueryProvider>
    </AuthProvider>
  );
}
