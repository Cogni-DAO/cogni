// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/work-items`
 * Purpose: Work item port interfaces, domain types, and status transition table.
 * Scope: Public barrel export. Does not contain I/O or adapter code.
 * Invariants: All exports are pure types, interfaces, or data constants.
 * Side-effects: none
 * Links: docs/spec/development-lifecycle.md, docs/spec/identity-model.md
 * @public
 */

export type { WorkItemCommandPort, WorkItemQueryPort } from "./ports.js";
export { isValidTransition, VALID_TRANSITIONS } from "./transitions.js";
export type {
  ActorKind,
  ExternalRef,
  RelationType,
  Revision,
  SubjectRef,
  WorkItem,
  WorkItemId,
  WorkItemStatus,
  WorkItemType,
  WorkQuery,
  WorkRelation,
} from "./types.js";
export { toWorkItemId } from "./types.js";
