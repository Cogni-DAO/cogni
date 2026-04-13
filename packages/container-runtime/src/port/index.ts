// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/container-runtime/port/index`
 * Purpose: Barrel export for container runtime port types and schemas.
 * Scope: Re-exports only. Does NOT implement logic.
 * Invariants: none
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @public
 */

export type {
  ContainerRuntimePort,
  GroupInfo,
  GroupSpec,
  PortMapping,
  ResourceLimits,
  WorkloadInfo,
  WorkloadSpec,
  WorkloadStatus,
} from "./container-runtime.port.js";

export {
  groupSpecSchema,
  portMappingSchema,
  resourceLimitsSchema,
  workloadSpecSchema,
  workloadStatusSchema,
} from "./container-runtime.port.js";
