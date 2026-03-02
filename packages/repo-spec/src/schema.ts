// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/repo-spec/schema`
 * Purpose: Zod schemas and derived types for .cogni/repo-spec.yaml validation.
 * Scope: Validates governance-managed payment, governance schedule, and activity ledger configuration structures. Does not enforce chain/token values (chain validation happens in accessor layer via chainId parameter).
 * Invariants: EVM address format required; activity sources require source_refs + streams. REPO_SPEC_AUTHORITY — single canonical schema definition.
 * Side-effects: none
 * Links: .cogni/repo-spec.yaml, docs/spec/node-operator-contract.md
 * @public
 */

import { z } from "zod";

/**
 * Schema for payments_in.credits_topup configuration.
 * Validates inbound payment settings structure.
 */
export const creditsTopupSpecSchema = z.object({
  /** Payment provider identifier (e.g., "cogni-usdc-backend-v1") */
  provider: z.string().min(1, "Provider must be a non-empty string"),

  /** EVM address receiving inbound payments (DAO wallet) */
  receiving_address: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{40}$/,
      "Receiving address must be a valid EVM address (0x + 40 hex chars)"
    ),

  /** Optional: Informational list of chain names (not enforced by schema) */
  allowed_chains: z.array(z.string()).optional(),

  /** Optional: Informational list of token names (not enforced by schema) */
  allowed_tokens: z.array(z.string()).optional(),
});

export type CreditsTopupSpec = z.infer<typeof creditsTopupSpecSchema>;

/**
 * Schema for a single governance schedule entry.
 * Each schedule triggers an OpenClaw gateway run with a 1-word entrypoint.
 * Invariants: Charter must be unique per config; cron must be 5 fields; entrypoint must be 1 token (no spaces).
 */
export const governanceScheduleSchema = z.object({
  /** Charter name (e.g., COMMUNITY, ENGINEERING, SUSTAINABILITY, GOVERN) */
  charter: z.string().min(1, "Charter must be non-empty"),
  /** 5-field cron expression (minute hour day month weekday) */
  cron: z
    .string()
    .regex(
      /^(\S+\s+){4}\S+$/,
      "Cron must be a 5-field expression (minute hour day month weekday)"
    ),
  /** IANA timezone (defaults to UTC) */
  timezone: z.string().default("UTC"),
  /** Trigger word sent to OpenClaw gateway (single token, no spaces) */
  entrypoint: z
    .string()
    .regex(/^\S+$/, "Entrypoint must be a single token (no spaces)"),
});

export type GovernanceScheduleSpec = z.infer<typeof governanceScheduleSchema>;

/**
 * Schema for the governance section of repo-spec.
 * Optional — existing deployments without this section continue to work.
 */
export const governanceSpecSchema = z.object({
  schedules: z
    .array(governanceScheduleSchema)
    .default([])
    .refine(
      (arr) =>
        new Set(arr.map((s) => s.charter.toLowerCase())).size === arr.length,
      { message: "Duplicate charter names in governance.schedules" }
    ),
});

export type GovernanceSpec = z.infer<typeof governanceSpecSchema>;

/**
 * Schema for activity_ledger section — epoch and ingestion configuration.
 */
export const activitySourceSpecSchema = z.object({
  /** Credit estimation algorithm reference (e.g., "cogni-v0.0") */
  credit_estimate_algo: z.string().min(1),
  /** External namespaces for cursor scoping (e.g., repo slugs) */
  source_refs: z.array(z.string().min(1)).min(1),
  /** Stream IDs to collect (e.g., ["pull_requests", "reviews", "issues"]) */
  streams: z.array(z.string().min(1)).min(1),
});

export type ActivitySourceSpec = z.infer<typeof activitySourceSpecSchema>;

/**
 * Schema for pool_config — governance-managed pool budget parameters.
 */
export const poolConfigSpecSchema = z.object({
  /** Base issuance in credits (string → bigint). Governance-set budget per epoch. */
  base_issuance_credits: z
    .string()
    .min(1, "base_issuance_credits must be a non-empty string"),
});

export type PoolConfigSpec = z.infer<typeof poolConfigSpecSchema>;

export const activityLedgerSpecSchema = z.object({
  /** Epoch length in days (1–90) */
  epoch_length_days: z.number().int().min(1).max(90),
  /** EVM addresses allowed to mutate ledger data (allocations, pool components) */
  approvers: z
    .array(
      z
        .string()
        .regex(
          /^0x[a-fA-F0-9]{40}$/,
          "Each approver must be a valid EVM address (0x + 40 hex chars)"
        )
    )
    .default([]),
  /** Map of source name → source config */
  activity_sources: z.record(z.string(), activitySourceSpecSchema),
  /** Pool budget configuration (optional — defaults to 0 base issuance if missing) */
  pool_config: poolConfigSpecSchema.optional(),
});

export type ActivityLedgerSpec = z.infer<typeof activityLedgerSpecSchema>;

// ---------------------------------------------------------------------------
// Scope identity primitives
// ---------------------------------------------------------------------------

/** Stable opaque scope identifier — always UUID */
export const scopeIdSchema = z.string().uuid();

/** Human-friendly scope slug — lowercase, kebab, max 32 chars */
export const scopeKeySchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

/**
 * Schema for full .cogni/repo-spec.yaml structure.
 * Validates structure only; chain alignment checked in accessors via chainId parameter.
 */
export const repoSpecSchema = z.object({
  /** Unique node identity — scopes all ledger tables. Generated once at init, never changes. */
  node_id: z.string().uuid("node_id must be a valid UUID"),

  /** Stable opaque scope UUID — DB FK, never changes. Optional for backward compat. */
  scope_id: scopeIdSchema.optional(),

  /** Human-friendly scope slug — for display, logs, schedule IDs. Optional for backward compat. */
  scope_key: scopeKeySchema.optional(),

  /** Activity ledger configuration (optional — needed only when LEDGER_INGEST is enabled) */
  activity_ledger: activityLedgerSpecSchema.optional(),

  /** DAO governance configuration */
  cogni_dao: z.object({
    /**
     * Chain ID as string or number (YAML flexibility).
     * Validated against expected chain ID at extraction time.
     */
    chain_id: z.union([z.string(), z.number()]),
  }),

  /** Payment configuration (required) */
  payments_in: z.object({
    /** Inbound payment configuration for USDC credits top-up (required) */
    credits_topup: creditsTopupSpecSchema,
  }),

  /** Governance schedule configuration (optional — defaults to empty schedules) */
  governance: governanceSpecSchema.optional().default({ schedules: [] }),
});

export type RepoSpec = z.infer<typeof repoSpecSchema>;
