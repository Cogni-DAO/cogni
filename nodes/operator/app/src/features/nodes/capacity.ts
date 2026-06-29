// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/nodes/capacity`
 * Purpose: MVP node-capacity policy — the operator's deterministic gate on birthing new wizard nodes.
 * Scope: Pure decision only. `evaluateNodeCapacity` decides allow/deny against a configured ceiling;
 *   the deployed-node count is supplied by the caller (the GitHub deploy plane reads the catalog).
 *   No IO, no env, no GitHub here.
 * Invariants:
 *   - DETERMINISTIC_AUTHORIZATION (merge-authority): the decision is a gate boolean, never LLM judgment.
 *   - CAPACITY_FROM_CATALOG_SSOT: the network node-count = `infra/catalog/*.yaml` entries with
 *     `type: node` + `source_repo` (wizard-born remote-source nodes) in the deployment parent repo —
 *     NOT `.gitmodules` (retired by #1647, CATALOG_SOURCE_SHA_IS_THE_DEPLOY_PIN) and NOT the
 *     RLS-scoped operator `nodes` table. Counting lives in `GitHubRepoWriter.countDeployedWizardNodes`.
 * Side-effects: none
 * Links: docs/spec/merge-authority.md, docs/spec/node-submodule-retirement.md
 * @public
 */

import {
  type EnvCapacityBudget,
  evaluateResourceFit,
  type ResourceFitReport,
  type WorkloadDemand,
} from "@cogni/deploy-policy";

/** Outcome of the node-capacity gate. */
export interface NodeCapacityDecision {
  readonly allowed: boolean;
  readonly deployedNodeCount: number;
  readonly ceiling: number;
  readonly reason: string;
}

/**
 * MVP capacity gate: the operator allows a new node birth only while the network is below its compute
 * ceiling. At/over the ceiling the operator stops and hands back — the explicit boundary where
 * VM-capacity planning must begin (vNext). The ceiling is config (`NODE_CAPACITY_CEILING`), never a
 * hardcoded literal.
 */
export function evaluateNodeCapacity(input: {
  readonly deployedNodeCount: number;
  readonly ceiling: number;
}): NodeCapacityDecision {
  const { deployedNodeCount, ceiling } = input;
  const allowed = deployedNodeCount < ceiling;
  return {
    allowed,
    deployedNodeCount,
    ceiling,
    reason: allowed
      ? `under capacity (${deployedNodeCount}/${ceiling} nodes)`
      : `network at node capacity (${deployedNodeCount}/${ceiling}) — needs compute/VM planning before adding nodes`,
  };
}

export interface NodePublishResourceFitDecision {
  readonly allowed: boolean;
  readonly env: string;
  readonly reason: string;
  readonly projectedNodeSlug: string;
  readonly report: ResourceFitReport;
}

const STANDARD_NODE_APP_POD = {
  memoryMi: 384,
  cpuMilli: 200,
} as const;

const STANDARD_ROLLOUT_EXTRA_REPLICAS = 1;

const SCHEDULER_WORKER_WORKLOAD: WorkloadDemand = {
  kind: "Deployment",
  name: "scheduler-worker",
  replicas: 2,
  rolloutExtraReplicas: 1,
  podRequestMemoryMi: 256,
  podRequestCpuMilli: 250,
  effectiveMemoryMi: 768,
  effectiveCpuMilli: 750,
  missingRequests: [],
};

/**
 * Resource-fit projection for the node wizard publish seam.
 *
 * This deliberately mirrors the current node-template rendered footprint instead
 * of calling kustomize from the web route: one node-app Deployment, one rollout
 * surge replica, and max(initContainers, containers) = 384Mi/200m per pod.
 * The CI/flight guard remains the rendered-manifest authority; this publish
 * check is the early refusal before GitHub/DoltHub writes.
 */
export function evaluateNodePublishResourceFit(input: {
  readonly env: string;
  readonly budget: EnvCapacityBudget;
  readonly deployedWizardNodeCount: number;
  readonly projectedNodeSlug: string;
}): NodePublishResourceFitDecision {
  const existingNodeAppCount = input.deployedWizardNodeCount + 1;
  const baselineWorkloads = [
    SCHEDULER_WORKER_WORKLOAD,
    ...Array.from({ length: existingNodeAppCount }, (_, index) =>
      standardNodeAppWorkload(`existing-node-app-${index + 1}`)
    ),
  ];
  const workloads = [
    ...baselineWorkloads,
    standardNodeAppWorkload(input.projectedNodeSlug),
  ];
  const report = evaluateResourceFit({
    env: input.env,
    budget: input.budget,
    workloads,
    baselineWorkloads,
  });

  return {
    allowed: report.allowed,
    env: input.env,
    reason: report.reason,
    projectedNodeSlug: input.projectedNodeSlug,
    report,
  };
}

function standardNodeAppWorkload(name: string): WorkloadDemand {
  const effectiveReplicas = 1 + STANDARD_ROLLOUT_EXTRA_REPLICAS;
  return {
    kind: "Deployment",
    name,
    replicas: 1,
    rolloutExtraReplicas: STANDARD_ROLLOUT_EXTRA_REPLICAS,
    podRequestMemoryMi: STANDARD_NODE_APP_POD.memoryMi,
    podRequestCpuMilli: STANDARD_NODE_APP_POD.cpuMilli,
    effectiveMemoryMi: STANDARD_NODE_APP_POD.memoryMi * effectiveReplicas,
    effectiveCpuMilli: STANDARD_NODE_APP_POD.cpuMilli * effectiveReplicas,
    missingRequests: [],
  };
}
