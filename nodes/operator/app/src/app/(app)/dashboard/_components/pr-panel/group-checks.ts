// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/pr-panel/group-checks`
 * Purpose: Presentation-only grouping of the flat `CiStatusResult.checks[]`
 *          into a "CI" bucket and a "Flight (candidate-a)" bucket, based on
 *          check-run naming conventions. No grouping logic lives in the
 *          wire contract.
 * Scope: Pure functions over contract types.
 * Invariants:
 *   - Input is the flat `CheckInfo[]` from `@cogni/ai-tools`
 *   - Output is purely presentational; contract data is never mutated
 * Side-effects: none
 * Links: packages/ai-tools/src/capabilities/vcs.ts
 * @public
 */

import type { CheckInfo } from "@cogni/ai-tools";

/** Status the UI renders. Normalized from GitHub's `{status, conclusion}` pair. */
export type UiCheckStatus = "passing" | "running" | "failed" | "pending";

export interface UiCheck {
  name: string;
  status: UiCheckStatus;
}

export interface CheckGroup {
  id: "ci" | "flight";
  title: string;
  status: UiCheckStatus;
  checks: UiCheck[];
}

/** Check-name prefixes we classify as flight/deploy stages. */
const FLIGHT_PREFIXES = [
  "candidate-flight",
  "flight-",
  "verify-buildsha",
  "argo",
  "deploy-",
] as const;

function normalize(check: CheckInfo): UiCheck {
  const { status, conclusion } = check;
  let ui: UiCheckStatus;
  if (status !== "completed") {
    // GitHub status: queued, in_progress, waiting, pending, completed
    ui = status === "in_progress" ? "running" : "pending";
  } else if (
    conclusion === "success" ||
    conclusion === "neutral" ||
    conclusion === "skipped"
  ) {
    ui = "passing";
  } else if (conclusion === null) {
    ui = "pending";
  } else {
    // failure, timed_out, cancelled, action_required, stale
    ui = "failed";
  }
  return { name: check.name, status: ui };
}

function isFlight(checkName: string): boolean {
  const lower = checkName.toLowerCase();
  return FLIGHT_PREFIXES.some((p) => lower.startsWith(p));
}

/** Roll up a list of normalized check statuses to a single group status. */
function rollup(checks: UiCheck[]): UiCheckStatus {
  if (checks.length === 0) return "pending";
  if (checks.some((c) => c.status === "failed")) return "failed";
  if (checks.some((c) => c.status === "running")) return "running";
  if (checks.every((c) => c.status === "passing")) return "passing";
  return "pending";
}

export function groupChecks(checks: readonly CheckInfo[]): CheckGroup[] {
  const ciChecks: UiCheck[] = [];
  const flightChecks: UiCheck[] = [];
  for (const raw of checks) {
    const ui = normalize(raw);
    (isFlight(ui.name) ? flightChecks : ciChecks).push(ui);
  }
  const groups: CheckGroup[] = [
    {
      id: "ci",
      title: "CI Pipeline",
      status: rollup(ciChecks),
      checks: ciChecks,
    },
  ];
  if (flightChecks.length > 0) {
    groups.push({
      id: "flight",
      title: "Flight (candidate-a)",
      status: rollup(flightChecks),
      checks: flightChecks,
    });
  }
  return groups;
}

/**
 * Overall PR indicator status. Folds CI + flight + deploy_verified into one dot.
 */
export function overallStatus(args: {
  ci: UiCheckStatus;
  flight: UiCheckStatus | undefined;
  deployVerified: boolean | undefined;
}): UiCheckStatus {
  if (args.ci === "failed" || args.flight === "failed") return "failed";
  if (args.deployVerified) return "passing";
  if (args.flight === "running" || args.ci === "running") return "running";
  if (args.ci === "passing" && args.flight === undefined) return "passing";
  if (args.ci === "passing" && args.flight === "passing") {
    // flighted but not yet verified — treat as running (awaiting credit)
    return "running";
  }
  return "pending";
}
