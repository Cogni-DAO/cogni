// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/internship.interest.v1`
 * Purpose: Public internship interest signup operation contract.
 * Scope: Defines wire input and output for the recruitment interest endpoint.
 * Invariants: VALIDATE_IO; keep payload small and recruitment-specific.
 * Side-effects: none
 * Links: story.5001
 * @public
 */

import { z } from "zod";

const InternshipFocusSchema = z.enum([
  "x402-apps",
  "attribution-scoring",
  "node-infrastructure",
  "dao-operations",
  "research-product",
  "undecided",
]);

const FirstProjectChoiceSchema = z.enum([
  "agent-workflows",
  "knowledge-capture",
  "dao-incentives",
  "infrastructure",
  "unsure",
]);

export const internshipInterestOperation = {
  id: "internship.interest.v1",
  summary: "Submit Cogni internship interest",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(240),
    github: z.string().trim().max(120).optional(),
    artifactUrl: z.string().trim().url().max(500).optional(),
    focus: InternshipFocusSchema,
    squadStatus: z.enum(["solo", "forming", "squad-ready"]),
    timezone: z.string().trim().min(1).max(80),
    weeklyAvailability: z.string().trim().min(1).max(240),
    artifactNotes: z.string().trim().min(1).max(1000),
    whyCogni: z.string().trim().min(1).max(1000),
    firstProjectChoice: FirstProjectChoiceSchema,
    reliableCommitment: z.string().trim().min(1).max(500),
    recordingConsent: z.boolean(),
    note: z.string().trim().max(1000).optional(),
  }),
  output: z.object({
    ok: z.literal(true),
    referenceId: z.string(),
    derekInterviewUrl: z.string().url(),
  }),
} as const;

export type InternshipInterestInput = z.infer<
  typeof internshipInterestOperation.input
>;
export type InternshipInterestOutput = z.infer<
  typeof internshipInterestOperation.output
>;
