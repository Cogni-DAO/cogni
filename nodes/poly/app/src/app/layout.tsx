import "../styles/tailwind.css";

import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Cogni Poly — Community AI Prediction Trading",
  description:
    "Community-pooled AI trading across Polymarket, Kalshi, and more. Transparent, DAO-governed, collectively intelligent.",
};

// biome-ignore lint/style/noDefaultExport: required by Next.js
export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} ${inter.className}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
