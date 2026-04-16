// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/capabilities/vcs`
 * Purpose: VCS capability interface for AI tools — GitHub API operations (PR management, branches, CI status).
 * Scope: Defines VcsCapability for remote VCS operations. Does NOT implement transport.
 * Invariants:
 *   - CAPABILITY_INJECTION: Implementation injected at bootstrap, not imported
 *   - VCS_WRITE_CAPABLE: Supports both read and write operations (merge, branch creation)
 *   - ADAPTER_SWAPPABLE: Interface supports Octokit (v0) or gh CLI (future sandbox agents)
 * Side-effects: none (interface only)
 * Links: task.0242, docs/guides/github-app-webhook-setup.md
 * @public
 */

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Summary of a pull request for listing. */
export interface PrSummary {
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly labels: readonly string[];
  readonly draft: boolean;
  readonly mergeable: boolean | null;
  readonly updatedAt: string;
}

/** Individual check run/status result. */
export interface CheckInfo {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
}

/** Combined CI status for a pull request. */
export interface CiStatusResult {
  readonly prNumber: number;
  readonly prTitle: string;
  readonly author: string;
  readonly baseBranch: string;
  readonly headSha: string;
  readonly mergeable: boolean | null;
  readonly reviewDecision: string | null;
  readonly labels: readonly string[];
  readonly draft: boolean;
  readonly allGreen: boolean;
  readonly pending: boolean;
  readonly checks: readonly CheckInfo[];
}

/** Result of merging a pull request. */
export interface MergeResult {
  readonly merged: boolean;
  readonly sha?: string;
  readonly message: string;
}

/** Result of creating a branch. */
export interface CreateBranchResult {
  readonly ref: string;
  readonly sha: string;
}

// ---------------------------------------------------------------------------
// Capability interface
// ---------------------------------------------------------------------------

/**
 * VCS capability for AI tools — remote GitHub operations.
 *
 * Per CAPABILITY_INJECTION: implementation injected at bootstrap time.
 * Per ADAPTER_SWAPPABLE: Octokit adapter for v0; gh CLI adapter for sandbox agents.
 *
 * The implementation resolves GitHub App auth internally —
 * tools never see tokens or installation IDs.
 */
export interface VcsCapability {
  /** List pull requests with optional state filter. */
  listPrs(params: {
    owner: string;
    repo: string;
    state?: "open" | "closed" | "all";
  }): Promise<readonly PrSummary[]>;

  /** Get detailed CI/review status for a specific PR. */
  getCiStatus(params: {
    owner: string;
    repo: string;
    prNumber: number;
  }): Promise<CiStatusResult>;

  /** Merge a pull request. */
  mergePr(params: {
    owner: string;
    repo: string;
    prNumber: number;
    method: "squash" | "merge" | "rebase";
  }): Promise<MergeResult>;

  /** Create a new branch from a ref (branch name or SHA). */
  createBranch(params: {
    owner: string;
    repo: string;
    branch: string;
    fromRef: string;
  }): Promise<CreateBranchResult>;
}
