// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/layout/components/footer-items`
 * Purpose: Footer column and link data for AppFooter.
 * Scope: Static data definitions only. Does not render UI or handle routing.
 * Invariants: All external links have external: true.
 * Side-effects: none
 * Links: src/features/layout/components/AppFooter.tsx
 * @public
 */

export interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Platform",
    links: [
      { label: "Chat", href: "/chat" },
      { label: "Work", href: "/work" },
      { label: "Activity", href: "/activity" },
      { label: "Governance", href: "/gov" },
      { label: "Credits", href: "/credits" },
    ],
  },
  {
    title: "About",
    links: [
      { label: "SourceCred", href: "/sourcecred/", external: false },
      {
        label: "Documentation",
        href: "https://github.com/cogni-DAO/cogni-template",
        external: true,
      },
    ],
  },
  {
    title: "Community",
    links: [
      {
        label: "GitHub",
        href: "https://github.com/cogni-DAO/cogni-template",
        external: true,
      },
      {
        label: "Discord",
        href: "https://discord.gg/3b9sSyhZ4z",
        external: true,
      },
    ],
  },
];
