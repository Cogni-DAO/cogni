// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/vcs.create-pr.v1`
 * Purpose: Zod contract for POST /api/v1/vcs/pr — open a GitHub PR from an existing remote branch.
 * Scope: Input/output wire shape only. Does not contain business logic or adapters.
 * Invariants: CONTRACTS_ARE_TRUTH — single source for create-PR wire shape.
 * Side-effects: none
 * Links: task.0360, docs/guides/agent-api-validation.md
 * @public
 */

import { z } from "zod";

export const createPrOperation = {
  id: "vcs.create-pr.v1",
  input: z.object({
    branch: z.string().min(1),
    title: z.string().min(1).max(256),
    body: z.string().max(65536).default(""),
    base: z.string().min(1).default("main"),
  }),
  output: z.object({
    prNumber: z.number().int().positive(),
    url: z.string().url(),
    status: z.literal("open"),
  }),
} as const;

export type CreatePrInput = z.infer<typeof createPrOperation.input>;
export type CreatePrOutput = z.infer<typeof createPrOperation.output>;
