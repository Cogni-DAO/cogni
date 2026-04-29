// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/service/contribution-service`
 * Purpose: Framework-agnostic typed handlers for the knowledge contribution flow.
 * Scope: Pure business logic — quotas, idempotency lookup, role gating, confidence cap.
 *   No HTTP, no env, no lifecycle. Per-node `route.ts` files adapt these to Next.
 * Invariants: KNOWLEDGE_MERGE_REQUIRES_ADMIN_SESSION; agent confidence capped at 30.
 * Side-effects: delegates to KnowledgeContributionPort
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
import {
  ContributionForbiddenError,
  type KnowledgeContributionPort,
  ContributionQuotaError,
} from "../port/contribution.port.js";

export interface CreateBody {
  message: string;
  entries: KnowledgeEntryInput[];
  idempotencyKey?: string;
}

export interface ListQuery {
  state?: ContributionState | "all";
  principalId?: string;
  limit?: number;
}

export interface ContributionServiceDeps {
  port: KnowledgeContributionPort;
  canMergeKnowledge: (p: Principal) => boolean;
  rateLimit: { maxOpenPerPrincipal: number };
}

export interface ContributionService {
  create(args: {
    principal: Principal;
    body: CreateBody;
  }): Promise<ContributionRecord>;
  list(args: {
    principal: Principal;
    query: ListQuery;
  }): Promise<ContributionRecord[]>;
  getById(contributionId: string): Promise<ContributionRecord | null>;
  diff(contributionId: string): Promise<ContributionDiffEntry[]>;
  merge(args: {
    principal: Principal;
    contributionId: string;
    confidencePct?: number;
  }): Promise<{ commitHash: string }>;
  close(args: {
    principal: Principal;
    contributionId: string;
    reason: string;
  }): Promise<void>;
}

export function createContributionService(
  deps: ContributionServiceDeps,
): ContributionService {
  return {
    async create({ principal, body }) {
      // Idempotency replay — return prior record if same (principal, key) exists.
      if (body.idempotencyKey) {
        const prior = await deps.port.list({
          state: "all",
          principalId: principal.id,
          limit: 100,
        });
        const hit = prior.find((r) => r.idempotencyKey === body.idempotencyKey);
        if (hit) return hit;
      }

      // Quota — N open contributions per principal.
      const open = await deps.port.list({
        state: "open",
        principalId: principal.id,
        limit: 100,
      });
      if (open.length >= deps.rateLimit.maxOpenPerPrincipal) {
        throw new ContributionQuotaError(
          `max open contributions per principal = ${deps.rateLimit.maxOpenPerPrincipal}`,
        );
      }

      return deps.port.create({
        principal,
        message: body.message,
        entries: body.entries,
        idempotencyKey: body.idempotencyKey,
      });
    },

    async list({ query }) {
      return deps.port.list({
        state: query.state ?? "open",
        principalId: query.principalId,
        limit: query.limit ?? 20,
      });
    },

    async getById(contributionId) {
      return deps.port.getById(contributionId);
    },

    async diff(contributionId) {
      return deps.port.diff(contributionId);
    },

    async merge({ principal, contributionId, confidencePct }) {
      if (!deps.canMergeKnowledge(principal)) {
        throw new ContributionForbiddenError("merge requires admin session");
      }
      return deps.port.merge({ contributionId, principal, confidencePct });
    },

    async close({ principal, contributionId, reason }) {
      if (!deps.canMergeKnowledge(principal)) {
        throw new ContributionForbiddenError("close requires admin session");
      }
      return deps.port.close({ contributionId, principal, reason });
    },
  };
}

export function defaultCanMergeKnowledge(p: Principal): boolean {
  return p.kind === "user" && p.role === "admin";
}
