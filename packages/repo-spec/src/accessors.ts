// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/repo-spec/accessors`
 * Purpose: Pure typed accessor functions that extract specific config sections from a parsed RepoSpec.
 * Scope: Maps raw YAML structures to app-friendly typed objects. Chain ID is always a parameter, not imported from app code.
 * Invariants: REPO_SPEC_AUTHORITY, NO_CROSS_IMPORTS. All functions are pure — no I/O, no caching, no side effects.
 * Side-effects: none
 * Links: .cogni/repo-spec.yaml, docs/spec/node-operator-contract.md
 * @public
 */

import type {
  GateConfig,
  NodeRegistryEntry,
  OperatorWalletSpec,
  RepoSpec,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Accessor result types
// ---------------------------------------------------------------------------

export interface GovernanceSchedule {
  charter: string;
  cron: string;
  timezone: string;
  entrypoint: string;
}

export interface LedgerPoolConfig {
  baseIssuanceCredits: bigint;
}

export interface LedgerConfig {
  scopeId: string;
  scopeKey: string;
  epochLengthDays: number;
  activitySources: Record<
    string,
    {
      attributionPipeline: string;
      sourceRefs: string[];
      excludedLogins?: string[];
    }
  >;
  poolConfig: LedgerPoolConfig;
  /** base_issuance_credits as string (bigint serialized) for schedule payload. */
  baseIssuanceCredits?: string;
  /** EVM approver addresses from repo-spec. */
  approvers?: string[];
}

export interface GovernanceConfig {
  schedules: GovernanceSchedule[];
  ledger?: LedgerConfig;
}

export interface InboundPaymentConfig {
  chainId: number;
  receivingAddress: string;
  provider: string;
}

// ---------------------------------------------------------------------------
// Identity accessors
// ---------------------------------------------------------------------------

/** Extract node_id from parsed repo-spec. */
export function extractNodeId(spec: RepoSpec): string {
  return spec.node_id;
}

/**
 * Extract scope_id from parsed repo-spec.
 * Throws if scope_id is not present (required for ledger scope gating).
 */
export function extractScopeId(spec: RepoSpec): string {
  if (!spec.scope_id) {
    throw new Error(
      "[repo-spec] Missing scope_id — required for ledger scope gating"
    );
  }
  return spec.scope_id;
}

/**
 * Extract numeric chain_id from cogni_dao section.
 * Handles both string and number representations from YAML.
 */
export function extractChainId(spec: RepoSpec): number {
  const raw = spec.cogni_dao.chain_id;
  const chainId = typeof raw === "string" ? Number(raw) : raw;

  if (!Number.isFinite(chainId)) {
    throw new Error(
      "[repo-spec] Invalid cogni_dao.chain_id; expected numeric chain ID"
    );
  }

  return chainId;
}

// ---------------------------------------------------------------------------
// Config section accessors
// ---------------------------------------------------------------------------

/**
 * Extract and validate inbound payment config.
 * Chain ID is passed as parameter (not imported from app code) and validated against repo-spec's declared chain.
 */
export function extractPaymentConfig(
  spec: RepoSpec,
  expectedChainId: number
): InboundPaymentConfig | undefined {
  if (!spec.payments_in?.credits_topup) return undefined;

  const chainId = extractChainId(spec);

  if (chainId !== expectedChainId) {
    throw new Error(
      `[repo-spec] Chain mismatch: repo-spec declares ${chainId}, app requires ${expectedChainId}`
    );
  }

  const topup = spec.payments_in.credits_topup;

  return {
    chainId,
    receivingAddress: topup.receiving_address.trim(),
    provider: topup.provider.trim(),
  };
}

/**
 * Extract governance config including schedules and optional ledger config.
 * Ledger config is only included when activity_ledger + scope identity are both present.
 */
export function extractGovernanceConfig(spec: RepoSpec): GovernanceConfig {
  const config: GovernanceConfig = {
    schedules: spec.governance?.schedules ?? [],
  };

  const ledger = extractLedgerConfig(spec);
  if (ledger) {
    config.ledger = ledger;
  }

  return config;
}

/**
 * Extract ledger config from repo-spec.
 * Returns null if activity_ledger or scope identity (scope_id + scope_key) is missing.
 */
export function extractLedgerConfig(spec: RepoSpec): LedgerConfig | null {
  if (!spec.activity_ledger || !spec.scope_id || !spec.scope_key) {
    return null;
  }

  const sources: LedgerConfig["activitySources"] = {};
  for (const [name, src] of Object.entries(
    spec.activity_ledger.activity_sources
  )) {
    sources[name] = {
      attributionPipeline: src.attribution_pipeline,
      sourceRefs: src.source_refs,
      excludedLogins: src.excluded_logins,
    };
  }

  const poolCfg = spec.activity_ledger.pool_config;
  const baseIssuanceCredits = poolCfg
    ? BigInt(poolCfg.base_issuance_credits)
    : 0n;

  return {
    scopeId: spec.scope_id,
    scopeKey: spec.scope_key,
    epochLengthDays: spec.activity_ledger.epoch_length_days,
    activitySources: sources,
    poolConfig: {
      baseIssuanceCredits,
    },
    baseIssuanceCredits: baseIssuanceCredits.toString(),
    approvers: spec.activity_ledger.approvers,
  };
}

/**
 * Extract ledger approver allowlist from repo-spec.
 * Returns lowercased EVM addresses for case-insensitive comparison.
 * Returns empty array if ledger config is not present.
 */
export function extractLedgerApprovers(spec: RepoSpec): string[] {
  return (spec.activity_ledger?.approvers ?? []).map((a) => a.toLowerCase());
}

// ---------------------------------------------------------------------------
// Gate config accessors
// ---------------------------------------------------------------------------

export interface GatesConfig {
  gates: GateConfig[];
  failOnError: boolean;
}

/**
 * Extract gates configuration from parsed repo-spec.
 * Returns empty gates array if no gates are configured.
 */
export function extractGatesConfig(spec: RepoSpec): GatesConfig {
  return {
    gates: spec.gates ?? [],
    failOnError: spec.fail_on_error ?? false,
  };
}

// ---------------------------------------------------------------------------
// DAO config
// ---------------------------------------------------------------------------

export interface DaoConfig {
  readonly dao_contract: string;
  readonly plugin_contract: string;
  readonly signal_contract: string;
  readonly chain_id: string;
  readonly base_url: string;
}

/**
 * Extract DAO governance configuration from parsed repo-spec.
 * Returns null if cogni_dao is missing or any required field is absent.
 * All five fields (dao_contract, plugin_contract, signal_contract, chain_id, base_url)
 * must be present for the config to be valid.
 */
export function extractDaoConfig(spec: RepoSpec): DaoConfig | null {
  const dao = spec.cogni_dao;
  if (
    !dao?.dao_contract ||
    !dao.plugin_contract ||
    !dao.signal_contract ||
    !dao.chain_id ||
    !dao.base_url
  ) {
    return null;
  }

  return {
    dao_contract: dao.dao_contract,
    plugin_contract: dao.plugin_contract,
    signal_contract: dao.signal_contract,
    chain_id: String(dao.chain_id),
    base_url: dao.base_url,
  };
}

/**
 * Extract operator wallet config from repo-spec.
 * Returns undefined if operator_wallet section is not present.
 */
export function extractOperatorWalletConfig(
  spec: RepoSpec
): OperatorWalletSpec | undefined {
  return spec.operator_wallet;
}

/**
 * Extract DAO treasury address from repo-spec.
 * Returns undefined if cogni_dao.dao_contract is not present.
 */
export function extractDaoTreasuryAddress(spec: RepoSpec): string | undefined {
  return spec.cogni_dao.dao_contract;
}

// ---------------------------------------------------------------------------
// Node registry accessors (operator-only)
// ---------------------------------------------------------------------------

/**
 * Extract node registry from operator repo-spec.
 * Returns empty array if nodes[] is not present (non-operator repo-specs).
 */
export function extractNodes(spec: RepoSpec): readonly NodeRegistryEntry[] {
  return spec.nodes ?? [];
}
