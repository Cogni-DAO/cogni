// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import type { ReactNode } from "react";

export const metadata = {
  title: "Cogni Auth Hub",
  description: "Centralized GitHub OAuth hub for local Cogni nodes.",
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          background: "#0a0f1a",
          color: "#f5f7fb",
        }}
      >
        {children}
      </body>
    </html>
  );
}
