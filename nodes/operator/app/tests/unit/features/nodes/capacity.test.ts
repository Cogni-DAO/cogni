// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import type { EnvCapacityBudget } from "@cogni/deploy-policy";
import { describe, expect, it } from "vitest";

import {
  evaluateNodeCapacity,
  evaluateNodePublishResourceFit,
} from "@/features/nodes/capacity";

const measuredBudget = {
  env: "production",
  mode: "strict",
  allocatable: {
    memoryMi: 2500,
    cpuMilli: 2000,
  },
  reservations: {
    composeMemoryMi: 0,
    kubeMemoryMi: 0,
    edgeMemoryMi: 0,
    requiredHeadroomMi: 0,
    reservedCpuMilli: 0,
    requiredCpuHeadroomMilli: 0,
  },
  rollout: {
    includeMaxSurge: true,
  },
  measurement: {
    source: "test",
    measuredAt: "2026-06-29",
  },
} satisfies EnvCapacityBudget;

describe("evaluateNodeCapacity", () => {
  it("allows a birth strictly below the ceiling", () => {
    const d = evaluateNodeCapacity({ deployedNodeCount: 7, ceiling: 8 });
    expect(d.allowed).toBe(true);
    expect(d.deployedNodeCount).toBe(7);
    expect(d.ceiling).toBe(8);
  });

  it("blocks at the ceiling (the hand-back boundary)", () => {
    const d = evaluateNodeCapacity({ deployedNodeCount: 8, ceiling: 8 });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/capacity/i);
  });

  it("blocks over the ceiling", () => {
    expect(
      evaluateNodeCapacity({ deployedNodeCount: 12, ceiling: 8 }).allowed
    ).toBe(false);
  });
});

describe("evaluateNodePublishResourceFit", () => {
  it("projects the standard operator/node-template footprint before publish", () => {
    const d = evaluateNodePublishResourceFit({
      env: "production",
      budget: measuredBudget,
      deployedWizardNodeCount: 0,
      projectedNodeSlug: "new-node",
    });

    expect(d.allowed).toBe(true);
    expect(d.report.workloads.map((workload) => workload.name)).toEqual([
      "scheduler-worker",
      "existing-node-app-1",
      "new-node",
    ]);
    expect(d.report.totals.requestedMemoryMi).toBe(2304);
    expect(d.report.totals.requestedCpuMilli).toBe(1550);
  });

  it("denies publish when the projected node worsens resource overage", () => {
    const d = evaluateNodePublishResourceFit({
      env: "production",
      budget: {
        ...measuredBudget,
        allocatable: {
          memoryMi: 2000,
          cpuMilli: 2000,
        },
      },
      deployedWizardNodeCount: 0,
      projectedNodeSlug: "new-node",
    });

    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/memory/i);
    expect(d.report.totals.memoryOverageMi).toBe(304);
    expect(d.report.baselineTotals?.memoryOverageMi).toBe(0);
  });
});
