// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import "@/styles/tailwind.css";
import "@rainbow-me/rainbowkit/styles.css";

import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { Providers } from "./providers.client";

const manrope = Manrope({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cogni Poly — Community AI Prediction Trading",
  description:
    "Community-pooled AI trading across Polymarket, Kalshi, and more. Transparent, DAO-governed, collectively intelligent.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  return (
    <html lang="en" className={manrope.className} suppressHydrationWarning>
      <head>
        <Script src="/theme-init.js" strategy="beforeInteractive" />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Providers>
            <div id="main">{children}</div>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
