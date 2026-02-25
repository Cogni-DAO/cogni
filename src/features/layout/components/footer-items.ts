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
