// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/scheduling/grant`
 * Purpose: Execution grant adapters split by trust boundary — user (appDb, RLS enforced) and worker (serviceDb, BYPASSRLS).
 * Scope: Implements ExecutionGrantUserPort and ExecutionGrantWorkerPort with Drizzle ORM. Does not contain business logic.
 * Invariants:
 * - Per GRANT_NOT_SESSION: Grants are durable, not session-based
 * - Per GRANT_SCOPES_CONSTRAIN_GRAPHS: Scope format is "graph:execute:{graphId}"
 * - withTenantScope called on every method (uniform invariant, no-op on serviceDb)
 * Side-effects: IO (database operations)
 * Links: ports/scheduling/execution-grant.port.ts, docs/spec/scheduler.md
 * @public
 */

import { executionGrants } from "@cogni/db-schema/scheduling";
import { type ActorId, type UserId, userActor } from "@cogni/ids";
import {
  type ExecutionGrant,
  type ExecutionGrantUserPort,
  type ExecutionGrantWorkerPort,
  GrantExpiredError,
  GrantNotFoundError,
  GrantRevokedError,
  GrantScopeMismatchError,
} from "@cogni/scheduler-core";
import { and, eq, isNull } from "drizzle-orm";
import type { Database, LoggerLike } from "../client";
import { withTenantScope } from "../tenant-scope";

// ── Shared helpers ───────────────────────────────────────────────

const defaultLogger: LoggerLike = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function toGrant(row: typeof executionGrants.$inferSelect): ExecutionGrant {
  return {
    id: row.id,
    userId: row.userId,
    billingAccountId: row.billingAccountId,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

function validateGrantFields(
  grantId: string,
  row: typeof executionGrants.$inferSelect
): ExecutionGrant {
  const now = new Date();

  if (row.revokedAt) {
    throw new GrantRevokedError(grantId, row.revokedAt);
  }

  if (row.expiresAt && row.expiresAt < now) {
    throw new GrantExpiredError(grantId, row.expiresAt);
  }

  return toGrant(row);
}

function checkGrantScopes(
  grant: ExecutionGrant,
  graphId: string
): ExecutionGrant {
  const hasWildcard = grant.scopes.includes("graph:execute:*");
  const hasSpecificScope = grant.scopes.includes(`graph:execute:${graphId}`);

  if (!hasWildcard && !hasSpecificScope) {
    throw new GrantScopeMismatchError(grant.id, graphId, grant.scopes);
  }

  return grant;
}

// ── User-facing adapter (appDb, RLS enforced) ────────────────────

export class DrizzleExecutionGrantUserAdapter
  implements ExecutionGrantUserPort
{
  private readonly logger: LoggerLike;

  constructor(
    private readonly db: Database,
    logger?: LoggerLike
  ) {
    this.logger = logger ?? defaultLogger;
  }

  async createGrant(input: {
    userId: UserId;
    billingAccountId: string;
    scopes: readonly string[];
    expiresAt?: Date;
  }): Promise<ExecutionGrant> {
    const actorId = userActor(input.userId);
    return withTenantScope(this.db, actorId, async (tx) => {
      const [row] = await tx
        .insert(executionGrants)
        .values({
          userId: input.userId,
          billingAccountId: input.billingAccountId,
          scopes: [...input.scopes],
          expiresAt: input.expiresAt ?? null,
        })
        .returning();

      if (!row) {
        throw new Error("Failed to create execution grant");
      }

      this.logger.info(
        { grantId: row.id, userId: input.userId },
        "Created execution grant"
      );

      return toGrant(row);
    });
  }

  async revokeGrant(callerUserId: UserId, grantId: string): Promise<void> {
    const actorId = userActor(callerUserId);
    await withTenantScope(this.db, actorId, async (tx) => {
      await tx
        .update(executionGrants)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(executionGrants.id, grantId),
            isNull(executionGrants.revokedAt)
          )
        );
    });

    this.logger.info({ grantId }, "Revoked execution grant");
  }

  async deleteGrant(callerUserId: UserId, grantId: string): Promise<void> {
    const actorId = userActor(callerUserId);
    await withTenantScope(this.db, actorId, async (tx) => {
      await tx.delete(executionGrants).where(eq(executionGrants.id, grantId));
    });

    this.logger.info({ grantId }, "Deleted execution grant");
  }

  async ensureGrant(input: {
    userId: UserId;
    billingAccountId: string;
    scopes: readonly string[];
  }): Promise<ExecutionGrant> {
    const actorId = userActor(input.userId);
    return withTenantScope(this.db, actorId, async (tx) => {
      // Find existing valid (non-revoked) grant
      const existing = await tx.query.executionGrants.findFirst({
        where: and(
          eq(executionGrants.userId, input.userId),
          eq(executionGrants.billingAccountId, input.billingAccountId),
          isNull(executionGrants.revokedAt)
        ),
      });

      if (
        existing &&
        (!existing.expiresAt || existing.expiresAt > new Date())
      ) {
        // Verify existing grant has all required scopes
        const missingScopes = [...input.scopes].filter(
          (s) => !existing.scopes.includes(s)
        );
        if (missingScopes.length === 0) {
          this.logger.info(
            { grantId: existing.id, userId: input.userId },
            "Found existing valid grant"
          );
          return toGrant(existing);
        }
        this.logger.warn(
          {
            grantId: existing.id,
            userId: input.userId,
            missingScopes,
          },
          "Existing grant missing required scopes, creating new grant"
        );
      }

      // Create new grant
      const [row] = await tx
        .insert(executionGrants)
        .values({
          userId: input.userId,
          billingAccountId: input.billingAccountId,
          scopes: [...input.scopes],
          expiresAt: null,
        })
        .returning();

      if (!row) {
        throw new Error("Failed to create execution grant");
      }

      this.logger.info(
        { grantId: row.id, userId: input.userId },
        "Created execution grant (ensureGrant)"
      );

      return toGrant(row);
    });
  }
}

// ── Worker adapter (serviceDb, BYPASSRLS — withTenantScope is no-op) ─

export class DrizzleExecutionGrantWorkerAdapter
  implements ExecutionGrantWorkerPort
{
  private readonly logger: LoggerLike;

  constructor(
    private readonly db: Database,
    logger?: LoggerLike
  ) {
    this.logger = logger ?? defaultLogger;
  }

  async validateGrant(
    actorId: ActorId,
    grantId: string
  ): Promise<ExecutionGrant> {
    return withTenantScope(this.db, actorId, async (tx) => {
      const row = await tx.query.executionGrants.findFirst({
        where: eq(executionGrants.id, grantId),
      });

      if (!row) {
        throw new GrantNotFoundError(grantId);
      }

      this.logger.info({ grantId }, "Validated execution grant");
      return validateGrantFields(grantId, row);
    });
  }

  async validateGrantForGraph(
    actorId: ActorId,
    grantId: string,
    graphId: string
  ): Promise<ExecutionGrant> {
    const grant = await this.validateGrant(actorId, grantId);
    this.logger.info(
      { grantId, graphId },
      "Validated execution grant for graph"
    );
    return checkGrantScopes(grant, graphId);
  }
}
