// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-app/providers`
 * Purpose: RainbowKit theme configuration matching the Cogni design system.
 * Scope: Pure theme factory functions. Does not handle theme detection or switching.
 * Invariants: Returns valid RainbowKit theme objects; uses exact CSS variable values from tailwind.css.
 * Side-effects: none
 * Links: https://www.rainbowkit.com/docs/theming
 * @public
 */

import { darkTheme, lightTheme } from "@rainbow-me/rainbowkit";

export function createAppLightTheme(): ReturnType<typeof lightTheme> {
  return lightTheme({
    accentColor: "hsl(210 40% 96.1%)",
    accentColorForeground: "hsl(215.4 16.3% 20%)",
    borderRadius: "medium",
  });
}

export function createAppDarkTheme(): ReturnType<typeof darkTheme> {
  return darkTheme({
    accentColor: "hsl(217.2 32.6% 17.5%)",
    accentColorForeground: "hsl(210 40% 98%)",
    borderRadius: "medium",
  });
}
