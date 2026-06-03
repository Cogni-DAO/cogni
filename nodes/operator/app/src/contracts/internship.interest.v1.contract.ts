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

const WalletAddressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/);

const WalletSignatureSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{130}$/);

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

const UnsignedInternshipInterestInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(240),
  github: z.string().trim().max(120).optional(),
  artifactUrl: z.string().trim().url().max(500).optional(),
  focus: InternshipFocusSchema,
  squadStatus: z.enum(["solo", "forming", "squad-ready"]),
  timezone: z.string().trim().min(1).max(80),
  weeklyAvailability: z.string().trim().min(1).max(240),
  artifactNotes: z.string().trim().min(1).max(700),
  whyCogni: z.string().trim().min(1).max(700),
  firstProjectChoice: FirstProjectChoiceSchema,
  recordingConsent: z.boolean(),
  note: z.string().trim().max(700).optional(),
});

const InternshipWalletSignatureSchema = z.object({
  walletAddress: WalletAddressSchema,
  walletSignature: WalletSignatureSchema,
  walletMessage: z.string().trim().min(1).max(2000),
  walletSignedAt: z.string().datetime(),
});

export const internshipInterestOperation = {
  id: "internship.interest.v1",
  summary: "Submit Cogni internship interest",
  input: UnsignedInternshipInterestInputSchema.and(
    InternshipWalletSignatureSchema
  ),
  output: z.object({
    ok: z.literal(true),
    referenceId: z.string(),
    derekInterviewUrl: z.string().url(),
  }),
} as const;

export type InternshipInterestInput = z.infer<
  typeof internshipInterestOperation.input
>;
export type UnsignedInternshipInterestInput = z.infer<
  typeof UnsignedInternshipInterestInputSchema
>;
export type InternshipInterestOutput = z.infer<
  typeof internshipInterestOperation.output
>;

export function buildInternshipApplicationMessage(
  input: UnsignedInternshipInterestInput & { walletSignedAt: string }
): string {
  const artifact = input.artifactUrl?.trim() || "not provided";
  const github = input.github?.trim() || "not provided";
  const note = input.note?.trim() || "not provided";

  return [
    "Cogni internship application",
    "",
    "I am submitting this application to Cogni and confirming that Derek may use this wallet signature as proof that I sent it.",
    "",
    `Name: ${input.name.trim()}`,
    `Email: ${input.email.trim()}`,
    `Wallet signed at: ${input.walletSignedAt}`,
    `GitHub or portfolio: ${github}`,
    `Best artifact: ${artifact}`,
    `Focus: ${input.focus}`,
    `Squad status: ${input.squadStatus}`,
    `Timezone: ${input.timezone.trim()}`,
    `Weekly availability: ${input.weeklyAvailability.trim()}`,
    `First project direction: ${input.firstProjectChoice}`,
    `AI note taker consent: ${input.recordingConsent ? "yes" : "no"}`,
    "",
    `Artifact notes: ${input.artifactNotes.trim()}`,
    "",
    `Why Cogni: ${input.whyCogni.trim()}`,
    "",
    `Extra note: ${note}`,
  ].join("\n");
}
