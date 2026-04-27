// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-contracts/vcs.flight.v1`
 * Purpose: Zod contract for POST /api/v1/vcs/flight — CI-gated candidate-a flight request.
 * Scope: Input/output shapes only. Does not make network calls or import GitHub API.
 * Invariants:
 *   - CONTRACTS_ARE_TRUTH: wire shape is owned by vcs.flight.v1.contract
 * Side-effects: none
 * Links: task.0361, nodes/operator/app/src/app/api/v1/vcs/flight/route.ts
 * @public
 */

import { z } from "zod";

export const flightOperation = {
  input: z.object({
    prNumber: z.number().int().positive(),
  }),

  output: z.object({
    dispatched: z.boolean(),
    slot: z.literal("candidate-a"),
    prNumber: z.number().int().positive(),
    headSha: z.string().nullable(),
    workflowUrl: z.string().url(),
    message: z.string(),
  }),
} as const;
