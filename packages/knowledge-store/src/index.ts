// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store`
 * Purpose: Knowledge data plane capability — port, domain types, and Zod schemas.
 * Scope: Root barrel exports port interface and domain types. Does not export adapter implementations (use subpath imports).
 * Invariants: PACKAGES_NO_ENV, PACKAGES_NO_LIFECYCLE, PACKAGES_NO_SRC_IMPORTS.
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md
 * @public
 */

// Capability factory (shared across all nodes)
export { createKnowledgeCapability } from "./capability.js";
// Domain types & schemas
export {
  type DoltCommit,
  DoltCommitSchema,
  type DoltDiffEntry,
  DoltDiffEntrySchema,
  type Knowledge,
  KnowledgeSchema,
  type NewKnowledge,
  NewKnowledgeSchema,
  type SourceType,
  SourceTypeSchema,
} from "./domain/schemas.js";
// Port interface
export type { KnowledgeStorePort } from "./port/knowledge-store.port.js";
