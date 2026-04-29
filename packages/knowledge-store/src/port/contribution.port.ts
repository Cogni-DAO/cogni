// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/port/contribution.port`
 * Purpose: Port interface for external-agent knowledge contributions backed by Dolt branches.
 * Scope: Interface + typed error classes. No implementation.
 * Invariants: EXTERNAL_CONTRIB_VIA_BRANCH, KNOWLEDGE_MERGE_REQUIRES_ADMIN_SESSION.
 * Side-effects: none
 * Links: docs/design/knowledge-contribution-api.md
 * @public
 */

import type {
  ContributionDiffEntry,
  ContributionRecord,
  ContributionState,
  KnowledgeEntryInput,
  Principal,
} from "../domain/contribution-schemas.js";

export interface KnowledgeContributionPort {
  create(input: {
    principal: Principal;
    message: string;
    entries: KnowledgeEntryInput[];
    idempotencyKey?: string;
  }): Promise<ContributionRecord>;

  list(query: {
    state: ContributionState | "all";
    principalId?: string;
    limit: number;
  }): Promise<ContributionRecord[]>;

  getById(contributionId: string): Promise<ContributionRecord | null>;

  diff(contributionId: string): Promise<ContributionDiffEntry[]>;

  merge(input: {
    contributionId: string;
    principal: Principal;
    confidencePct?: number;
  }): Promise<{ commitHash: string }>;

  close(input: {
    contributionId: string;
    principal: Principal;
    reason: string;
  }): Promise<void>;
}

export class ContributionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContributionConflictError";
  }
}

export class ContributionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContributionNotFoundError";
  }
}

export class ContributionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContributionStateError";
  }
}

export class ContributionQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContributionQuotaError";
  }
}

export class ContributionForbiddenError extends Error {
  constructor(message: string = "forbidden") {
    super(message);
    this.name = "ContributionForbiddenError";
  }
}
