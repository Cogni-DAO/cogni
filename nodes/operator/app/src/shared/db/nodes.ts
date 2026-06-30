// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/db/nodes`
 * Purpose: Operator-local Drizzle schema for the externally-registered node registry.
 * Scope: Wizard working state for operator-managed nodes. Existing inline nodes
 *   (operator/resy/canary/node-template) are NOT registered here — they live in `infra/catalog/*.yaml`.
 * Invariants: NODES_TABLE_SCOPE (external only), STATE_MACHINE_TOTAL, OWNER_GATING, NO_PRIVATE_KEYS,
 *   ONE_REPO_ONE_NODE — a GitHub repo `(repo_owner, repo_name)` maps to at most one node, enforced by a
 *   case-insensitive UNIQUE index on `(lower(repo_owner), lower(repo_name))`. This is the anti-theft
 *   authority for webhook ingestion routing (findNodeByRepo): a receipt for repo R can only ever resolve
 *   to R's single owning node, never be claimed by another node's ledger.
 *   OPERATOR_NODE_ROW_ID_IS_NODE_ID — `nodes.id` IS the operator's projection of the node's repo-spec
 *   `node_id` (the deployment-identity SSOT, docs/spec/identity-model.md). It is the OpenFGA `node:<id>`
 *   resource and the Loki `node` label, never an unrelated surrogate. Wizard creation's `defaultRandom()`
 *   is the act of minting that `node_id` — `publish` writes the same value into the minted repo-spec.
 *   An externally-formed node MUST be inserted with `id = <child repo-spec node_id>`, never a fresh UUID,
 *   so identity can never fork. `slug` is the human/agent addressing handle (see node-lookup.ts).
 * Side-effects: none
 * Links: docs/spec/identity-model.md, docs/spec/node-formation.md, work/projects/proj.node-formation-ui.md, task.5083
 * @public
 */

import { users } from "@cogni/db-schema/refs";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const NODE_STATUSES = [
  "dao_pending",
  "dao_formed",
  "published",
  "wallet_ready",
  "payments_ready",
  "active",
  "failed",
] as const;

export type NodeStatus = (typeof NODE_STATUSES)[number];

export const REPO_VISIBILITIES = ["public", "private"] as const;

export type RepoVisibility = (typeof REPO_VISIBILITIES)[number];

export const nodes = pgTable(
  "nodes",
  {
    // OPERATOR_NODE_ROW_ID_IS_NODE_ID: this is the node's repo-spec `node_id` projection, not a private
    // surrogate. `defaultRandom()` mints it for wizard-born nodes (publish copies it into the repo-spec);
    // an external-import path must instead insert the child's repo-spec `node_id` here.
    id: uuid("id").defaultRandom().primaryKey(),
    // Human/agent addressing handle. Unique; resolve `{id}` paths by id OR slug (node-lookup.ts).
    slug: text("slug").notNull().unique(),
    // Parent deployment repo for the submodule pin PR. Slug is the unique node key.
    repoUrl: text("repo_url").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    repoVisibility: text("repo_visibility").notNull().default("public"),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("dao_pending"),
    chainId: integer("chain_id"),
    daoAddress: text("dao_address"),
    pluginAddress: text("plugin_address"),
    signalAddress: text("signal_address"),
    tokenAddress: text("token_address"),
    operatorWalletAddress: text("operator_wallet_address"),
    operatorWalletPrivyId: text("operator_wallet_privy_id"),
    splitAddress: text("split_address"),
    daoTxHash: text("dao_tx_hash"),
    signalTxHash: text("signal_tx_hash"),
    signalBlockNumber: bigint("signal_block_number", { mode: "number" }),
    splitTxHash: text("split_tx_hash"),
    publishPrUrl: text("publish_pr_url"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "nodes_status_check",
      sql`${t.status} IN ('dao_pending','dao_formed','published','wallet_ready','payments_ready','active','failed')`
    ),
    check(
      "nodes_repo_visibility_check",
      sql`${t.repoVisibility} IN ('public','private')`
    ),
    index("nodes_owner_user_id_idx").on(t.ownerUserId),
    index("nodes_status_idx").on(t.status),
    // ONE_REPO_ONE_NODE: case-insensitive UNIQUE so one GitHub repo maps to exactly one node.
    // GitHub echoes repository.full_name with varying owner/name casing, so the uniqueness — and the
    // findNodeByRepo lookup that depends on it — MUST be over the lower()'d expressions, not raw text.
    uniqueIndex("nodes_repo_owner_name_lower_unique").on(
      sql`lower(${t.repoOwner})`,
      sql`lower(${t.repoName})`
    ),
  ]
).enableRLS();
