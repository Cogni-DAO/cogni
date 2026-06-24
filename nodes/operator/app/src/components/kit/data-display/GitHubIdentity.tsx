// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/data-display/GitHubIdentity`
 * Purpose: Canonical render of a GitHub account — profile-linked avatar + bold @handle, with an
 *   optional muted secondary line. One place that owns the github-account wiring (login → avatar URL
 *   + profile URL) so every surface that shows a developer's GitHub identity reads identically.
 * Scope: Presentational kit primitive over the Avatar kit. Takes a login string; no data fetching.
 *   Reused by the node "Agents" approval panel and intended for the attribution surface (same github
 *   account wiring, different RBAC).
 * Invariants: NEW_TAB_SAFE (target=_blank → rel=noopener noreferrer); avatar falls back to the
 *   handle's initial so a missing GitHub image never breaks the row.
 * Side-effects: none
 * Links: ./Avatar.tsx, src/features/nodes/access/NodeAccess.tsx
 * @public
 */

import { cn } from "@cogni/node-ui-kit/util/cn";
import type { ReactElement } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "./Avatar";

export interface GitHubIdentityProps {
  /** GitHub login/handle, without the leading `@`. */
  readonly login: string;
  /** Optional muted line under the handle (e.g. an agent's registered name). */
  readonly secondary?: string | null;
  /** Optional layout className on the row wrapper. */
  readonly className?: string;
}

/**
 * Avatar + `@handle` (both linking to the GitHub profile in a new tab) with an optional muted
 * secondary line. The handle is the hero; the secondary is demoted, truncated context.
 */
export function GitHubIdentity({
  login,
  secondary,
  className,
}: GitHubIdentityProps): ReactElement {
  const profileUrl = `https://github.com/${login}`;
  const newTab = { target: "_blank", rel: "noopener noreferrer" } as const;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <a href={profileUrl} {...newTab} className="shrink-0">
        <Avatar className="size-9">
          <AvatarImage
            src={`https://github.com/${login}.png?size=72`}
            alt={`@${login}`}
          />
          <AvatarFallback className="font-semibold text-muted-foreground text-xs">
            {login.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </a>
      <div className="min-w-0">
        <a
          href={profileUrl}
          {...newTab}
          className="font-semibold text-foreground text-sm hover:underline"
        >
          @{login}
        </a>
        {secondary ? (
          <p className="truncate text-muted-foreground text-xs">{secondary}</p>
        ) : null}
      </div>
    </div>
  );
}
