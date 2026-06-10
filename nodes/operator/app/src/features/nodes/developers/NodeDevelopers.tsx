// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/nodes/developers/NodeDevelopers`
 * Purpose: Owner-facing "Developers" section under the launch pack — replaces the DevTools-fetch
 *   hack with an in-UI request → approve / deny / revoke surface. Shows pending access requests and
 *   approved developers for one node, each scoped to flight (deploy-to-candidate) in v0.
 * Scope: Server-rendered layout from pre-fetched tracking rows + per-row client action islands.
 *   The OpenFGA `developer` tuple remains the authority; these rows are tracking/UX only.
 * Side-effects: none (DeveloperActions owns its IO)
 * Links: src/features/nodes/developer-requests.ts, ./DeveloperActions.client.tsx, docs/spec/rbac.md §6
 * @public
 */

import type { ReactElement } from "react";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components";
import type { DeveloperRequestRow } from "@/features/nodes/developer-requests";

import { DeveloperActions } from "./DeveloperActions.client";

interface Props {
  readonly nodeId: string;
  readonly requests: ReadonlyArray<DeveloperRequestRow>;
}

function agentLabel(row: DeveloperRequestRow): string {
  return row.agentDisplayName?.trim() || `Agent ${row.agentUserId.slice(0, 8)}`;
}

function DeveloperRow({
  nodeId,
  row,
  mode,
}: {
  readonly nodeId: string;
  readonly row: DeveloperRequestRow;
  readonly mode: "pending" | "approved";
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground text-sm">
          {agentLabel(row)}
        </p>
        <p className="truncate font-mono text-muted-foreground text-xs">
          {row.agentUserId}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Badge intent="secondary">Flight</Badge>
        {mode === "pending" ? (
          <DeveloperActions
            nodeId={nodeId}
            agentUserId={row.agentUserId}
            actions={[
              { decision: "approve", label: "Approve", variant: "default" },
              { decision: "reject", label: "Deny", variant: "outline" },
            ]}
          />
        ) : (
          <DeveloperActions
            nodeId={nodeId}
            agentUserId={row.agentUserId}
            actions={[
              { decision: "reject", label: "Revoke", variant: "destructive" },
            ]}
          />
        )}
      </div>
    </div>
  );
}

export function NodeDevelopers({ nodeId, requests }: Props): ReactElement {
  const pending = requests.filter((r) => r.status === "pending");
  const approved = requests.filter((r) => r.status === "approved");
  const isEmpty = pending.length === 0 && approved.length === 0;

  return (
    <Card className="mx-auto mt-4 w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Developers</CardTitle>
        <CardDescription>
          AI developers you grant <span className="font-medium">Flight</span>{" "}
          access can deploy this node to candidate. Approval is required before
          any flight — no DevTools, no tokens to paste.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isEmpty ? (
          <p className="rounded-lg border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
            No developer requests yet. When your AI developer requests access,
            it appears here for you to approve.
          </p>
        ) : null}

        {pending.length > 0 ? (
          <section className="space-y-2">
            <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Pending requests
            </h3>
            <div className="space-y-2">
              {pending.map((row) => (
                <DeveloperRow
                  key={row.id}
                  nodeId={nodeId}
                  row={row}
                  mode="pending"
                />
              ))}
            </div>
          </section>
        ) : null}

        {approved.length > 0 ? (
          <section className="space-y-2">
            <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Approved developers
            </h3>
            <div className="space-y-2">
              {approved.map((row) => (
                <DeveloperRow
                  key={row.id}
                  nodeId={nodeId}
                  row={row}
                  mode="approved"
                />
              ))}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
