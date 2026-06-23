// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@cogni/node-contracts/vcs.merge.v1`
 * Purpose: Zod contract for POST /api/v1/vcs/merge — agent-initiated, operator-executed
 *   merge of a green operator-monorepo PR into `main`.
 * Scope: Input/output shapes only. No network calls, no GitHub API import.
 * Invariants:
 *   - CONTRACTS_ARE_TRUTH: wire shape is owned by vcs.merge.v1.contract.
 *   - NO_REPO_FROM_AGENT: owner/repo are operator-resolved from env, never request body
 *     (anti-spoof). The agent supplies only the PR number on the operator's own monorepo.
 *   - SQUASH_ONLY: V0 merges with a single, predictable strategy.
 * Side-effects: none
 * Links: nodes/operator/app/src/app/api/v1/vcs/merge/route.ts, docs/spec/development-lifecycle.md
 * @public
 */

import { z } from "zod";

export const mergeOperation = {
  input: z.object({
    prNumber: z.number().int().positive(),
    method: z.literal("squash").default("squash"),
  }),

  output: z.object({
    merged: z.literal(true),
    prNumber: z.number().int().positive(),
    sha: z.string(),
    baseBranch: z.literal("main"),
    method: z.literal("squash"),
    message: z.string(),
  }),
} as const;
