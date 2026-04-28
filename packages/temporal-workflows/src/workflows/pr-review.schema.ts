// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/temporal-workflows/workflows/pr-review.schema`
 * Purpose: Zod schema for `PrReviewWorkflowInput` — the single source of truth for the PR-review workflow's input shape.
 * Scope: Schema definition + `z.infer<>` type export. Does not contain business logic, runtime I/O, or side-effects.
 * Invariants:
 *   - SINGLE_INPUT_CONTRACT: schema is the single source of truth (see Purpose).
 *   - DISPATCH_FAIL_FAST: producers parse with this schema before `workflowClient.start(...)`.
 * Side-effects: none
 * Links: task.0419, PR #1067 (modelRef-shape regression — the regression class this schema closes).
 * @public
 */

import { z } from "zod";

/**
 * Workflow input contract for `PrReviewWorkflow`.
 *
 * Source-of-truth Zod schema. Both the producer (`dispatchPrReview` in
 * `nodes/operator/app/src/app/_facades/review/dispatch.server.ts`) and the
 * consumer (`PrReviewWorkflow` + activities in `services/scheduler-worker`)
 * consume the inferred type via `z.infer<typeof PrReviewWorkflowInputSchema>`.
 *
 * Why a Zod schema and not a plain TS interface? Workflow input flows over
 * Temporal's wire (activity payloads serialize/deserialize as JSON). A TS
 * interface only enforces shape at compile time on each side independently —
 * if dispatch and activity drift in a field's name or type, the Temporal
 * runtime happily passes a malformed object through. PR #1067 fixed exactly
 * this regression for `model` → `modelRef`. A Zod schema validated at the
 * dispatch boundary catches the drift at the source.
 */
export const PrReviewWorkflowInputSchema = z
  .object({
    /** Originating node ID from repo-spec (UUID). Routes execution to correct node. */
    nodeId: z.string().uuid(),
    /** GitHub repo owner (login). */
    owner: z.string().min(1),
    /** GitHub repo name. */
    repo: z.string().min(1),
    /** Pull request number. */
    prNumber: z.number().int().positive(),
    /** PR head SHA — 40-char hex (Git SHA-1). Keys workflow idempotency + identifies the build. */
    headSha: z.string().regex(/^[a-f0-9]{40}$/),
    /** GitHub App installation ID for this repo. */
    installationId: z.number().int().positive(),
    /** System principal user ID (UUID). COGNI_SYSTEM_PRINCIPAL_USER_ID from @cogni/ids constants. */
    actorUserId: z.string().uuid(),
    /** System billing account ID (UUID). Resolved by webhook handler from DB. */
    billingAccountId: z.string().uuid(),
    /** System virtual key ID. Resolved by webhook handler from DB. */
    virtualKeyId: z.string().min(1),
  })
  .strict();
// .strict() mode: typo'd field names (`virtualKeyld` with lowercase L,
// `pull_request_number` instead of `prNumber`) reject at parse time.
// Default Zod `.passthrough()`/strip behavior would silently ignore them,
// recreating the modelRef-shape regression class for renamed fields.

/**
 * Inferred TS type for `PrReviewWorkflow`'s input.
 *
 * Per SINGLE_INPUT_CONTRACT: never duplicate this shape as a separate
 * interface. Always `import { type PrReviewWorkflowInput } from ...` and
 * let the Zod schema be the source of truth.
 */
export type PrReviewWorkflowInput = z.infer<typeof PrReviewWorkflowInputSchema>;
