import {
  Activity,
  Briefcase,
  CreditCard,
  Github,
  Vote,
} from "lucide-react";

import type { NodeAppConfig } from "@cogni/node-app/extensions";

export const nodeConfig: NodeAppConfig = {
  name: "Resy",
  logo: { src: "/TransparentBrainOnly.png", alt: "Resy", href: "/chat" },
  navItems: [
    { href: "/work", label: "Work", icon: Briefcase },
    { href: "/activity", label: "Activity", icon: Activity },
    { href: "/gov", label: "Gov", icon: Vote },
    { href: "/credits", label: "Credits", icon: CreditCard },
  ],
  externalLinks: [
    { href: "https://github.com/cogni-dao", label: "GitHub", icon: Github },
  ],
};
