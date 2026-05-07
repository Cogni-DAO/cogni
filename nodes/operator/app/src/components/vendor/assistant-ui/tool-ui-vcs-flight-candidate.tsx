// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/vendor/assistant-ui/tool-ui-vcs-flight-candidate`
 * Purpose: Per-tool renderer for `core__vcs_flight_candidate` — narrates dispatch as a 1-liner with linked PR / sha / candidate-a chips, with workflow-run + observability links in the collapsible body.
 * Scope: Mounted by `ToolUIRegistry` inside the AssistantRuntime context. Pure presentation over the typed tool args/result.
 * Side-effects: none
 * Links: packages/ai-tools/src/tools/vcs-flight-candidate.ts (input/output schema)
 * @public
 */

"use client";

import {
  makeAssistantToolUI,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import {
  ToolCard,
  type ToolCardTone,
  ToolChip,
} from "@cogni/node-ui-kit/tool-card";
import {
  AlertTriangleIcon,
  CircleSlashIcon,
  Loader2Icon,
  RocketIcon,
} from "lucide-react";

const TOOL_NAME = "core__vcs_flight_candidate";
const CANDIDATE_A_VERSION_URL = "https://test.cognidao.org/version";

interface FlightArgs {
  readonly owner?: string;
  readonly repo?: string;
  readonly prNumber?: number;
  readonly headSha?: string;
  readonly workflowRef?: string;
}

interface FlightResult {
  readonly dispatched?: boolean;
  readonly prNumber?: number;
  readonly headSha?: string | null;
  readonly workflowUrl?: string;
  readonly message?: string;
}

const FlightView: ToolCallMessagePartComponent<FlightArgs, FlightResult> = ({
  args,
  result,
  status,
}) => {
  const owner = args?.owner ?? "Cogni-DAO";
  const repo = args?.repo ?? "node-template";
  const prNumber = args?.prNumber ?? result?.prNumber;
  const sha = result?.headSha ?? args?.headSha ?? null;
  const workflowRef = args?.workflowRef;

  const isCancelled =
    status?.type === "incomplete" && status.reason === "cancelled";
  const hasError =
    status?.type === "incomplete" && status.reason !== "cancelled";
  const isRunning =
    status?.type === "running" || status?.type === "requires-action";
  const notDispatched =
    status?.type === "complete" && result?.dispatched === false;

  const Icon = isCancelled
    ? CircleSlashIcon
    : hasError || notDispatched
      ? AlertTriangleIcon
      : isRunning
        ? Loader2Icon
        : RocketIcon;
  const tone: ToolCardTone = isCancelled
    ? "muted"
    : hasError || notDispatched
      ? "danger"
      : isRunning
        ? "info"
        : "success";
  const iconClassName = isRunning ? "animate-spin" : undefined;

  const verb = isCancelled
    ? "Flight cancelled"
    : hasError
      ? "Flight failed"
      : notDispatched
        ? "Flight not dispatched"
        : isRunning
          ? "Flighting"
          : "Flighted";

  const prHref = prNumber
    ? `https://github.com/${owner}/${repo}/pull/${prNumber}`
    : undefined;
  const shaHref =
    sha != null
      ? `https://github.com/${owner}/${repo}/commit/${sha}`
      : undefined;

  const title = (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="font-medium">{verb}</span>
      {prNumber != null &&
        (prHref ? (
          <ToolChip href={prHref}>PR #{prNumber}</ToolChip>
        ) : (
          <ToolChip>PR #{prNumber}</ToolChip>
        ))}
      <span className="text-muted-foreground">to</span>
      <ToolChip mono href={CANDIDATE_A_VERSION_URL}>
        candidate-a
      </ToolChip>
      {sha && (
        <ToolChip mono href={shaHref} title={sha}>
          {sha.slice(0, 7)}
        </ToolChip>
      )}
      {workflowRef && workflowRef !== "main" && (
        <ToolChip mono title={`workflow ref: ${workflowRef}`}>
          via {workflowRef}
        </ToolChip>
      )}
    </span>
  );

  const errorText =
    hasError && status?.type === "incomplete" && status.error
      ? typeof status.error === "string"
        ? status.error
        : JSON.stringify(status.error)
      : null;

  const details = (
    <div className="flex flex-col gap-2 text-xs">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Repo</dt>
        <dd className="font-mono">
          {owner}/{repo}
        </dd>
        {prNumber != null && (
          <>
            <dt className="text-muted-foreground">PR</dt>
            <dd>#{prNumber}</dd>
          </>
        )}
        {sha && (
          <>
            <dt className="text-muted-foreground">Head SHA</dt>
            <dd className="break-all font-mono">{sha}</dd>
          </>
        )}
        {workflowRef && (
          <>
            <dt className="text-muted-foreground">Workflow ref</dt>
            <dd className="font-mono">{workflowRef}</dd>
          </>
        )}
        {result?.dispatched != null && (
          <>
            <dt className="text-muted-foreground">Dispatched</dt>
            <dd>{result.dispatched ? "yes" : "no"}</dd>
          </>
        )}
      </dl>

      {result?.message && (
        <div className="text-foreground/80">{result.message}</div>
      )}

      {errorText && (
        <pre className="whitespace-pre-wrap break-all rounded bg-danger/10 p-2 font-mono text-danger">
          {errorText}
        </pre>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 border-border/60 border-t border-dashed pt-2 text-muted-foreground">
        {result?.workflowUrl && (
          <a
            href={result.workflowUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            View workflow run on GitHub →
          </a>
        )}
        <a
          href={CANDIDATE_A_VERSION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          candidate-a /version ↗
        </a>
        <span>
          Observe via <code className="font-mono">core__vcs_get_ci_status</code>
        </span>
      </div>
    </div>
  );

  return (
    <ToolCard
      icon={Icon}
      iconClassName={iconClassName}
      tone={tone}
      title={title}
      details={details}
      defaultOpen={hasError || notDispatched}
    />
  );
};

export const VcsFlightCandidateToolUI = makeAssistantToolUI<
  FlightArgs,
  FlightResult
>({
  toolName: TOOL_NAME,
  render: FlightView,
});
