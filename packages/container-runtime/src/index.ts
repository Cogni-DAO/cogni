// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/container-runtime`
 * Purpose: Container runtime port — deploy images into isolated groups.
 * Scope: Public API surface. Does NOT contain runtime wiring.
 * Invariants: Adapters imported via subpath exports, not from root.
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
} from "./port/index.js";

export {
  groupSpecSchema,
  portMappingSchema,
  resourceLimitsSchema,
  workloadSpecSchema,
  workloadStatusSchema,
} from "./port/index.js";
