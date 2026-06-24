// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/nodes/components/NodeTile`
 * Purpose: Shared node tile — one clickable card used by the public homepage showcase AND the
 *   authed node-setup list. Handles live nodes (homepage screenshot, external link) and in-formation
 *   nodes (gradient placeholder, status badge, internal setup link) via one view model.
 * Scope: Presentational. Callers map their own data (NodeSummary / wizard rows) to NodeTileView.
 * Invariants: token-only styling; the entire tile is one link; a node without a committed screenshot
 *   falls back to a branded monogram placeholder (never a broken image); external links open in a new
 *   tab.
 * Side-effects: none
 * Links: src/features/home/components/NodeShowcase.tsx, src/app/(app)/nodes/page.tsx
 * @public
 */

import Image from "next/image";
import Link from "next/link";
import type { ReactElement } from "react";

import { Badge, Card } from "@/components";

export interface NodeTileView {
  readonly title: string;
  readonly tagline?: string | null | undefined;
  /** Homepage screenshot; when absent a gradient placeholder is shown. */
  readonly thumbnailUrl?: string | null | undefined;
  readonly href: string;
  /** External homepage (new tab) vs internal route (same tab). */
  readonly external?: boolean;
  /** Lifecycle badge for in-formation nodes. */
  readonly status?: {
    readonly label: string;
    readonly intent: "default" | "secondary" | "destructive" | "outline";
  } | null;
}

function Banner({
  thumbnailUrl,
  title,
}: {
  thumbnailUrl?: string | null | undefined;
  title: string;
}): ReactElement {
  if (thumbnailUrl) {
    return (
      <Image
        src={thumbnailUrl}
        alt={`${title} homepage`}
        fill
        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        className="object-cover object-top transition-transform group-hover:scale-105"
      />
    );
  }
  // No committed screenshot → a branded monogram placeholder. Intentional, not a gap: a subtle
  // diagonal token gradient with a faint dot-grid texture and the node's initial in a soft ring, so a
  // mixed gallery of screenshot-cards and placeholder-cards still reads as deliberate.
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br from-primary/20 via-primary/5 to-background">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18] [background-image:radial-gradient(circle,hsl(var(--foreground))_1px,transparent_1px)] [background-size:16px_16px]"
      />
      <span className="relative flex h-16 w-16 items-center justify-center rounded-full border border-primary/30 bg-background/60 font-bold text-3xl text-foreground/80 uppercase shadow-sm backdrop-blur-sm">
        {title.charAt(0)}
      </span>
    </div>
  );
}

export function NodeTile({ node }: { node: NodeTileView }): ReactElement {
  const linkProps = node.external
    ? { target: "_blank", rel: "noopener noreferrer" }
    : {};
  return (
    <Link href={node.href} className="group block rounded-lg" {...linkProps}>
      <Card className="h-full overflow-hidden transition-colors group-hover:border-primary">
        <div className="relative aspect-video w-full overflow-hidden border-border border-b bg-muted">
          <Banner thumbnailUrl={node.thumbnailUrl} title={node.title} />
        </div>
        <div className="space-y-2 p-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-foreground text-lg">
              {node.title}
            </h3>
            {node.status ? (
              <Badge intent={node.status.intent} size="sm">
                {node.status.label}
              </Badge>
            ) : null}
          </div>
          {node.tagline ? (
            <p className="text-muted-foreground text-sm">{node.tagline}</p>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}
