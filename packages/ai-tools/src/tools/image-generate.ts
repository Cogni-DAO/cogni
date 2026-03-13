// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/image-generate`
 * Purpose: AI tool for generating images from text prompts via LiteLLM.
 * Scope: Image generation with base64 output. Does NOT implement transport.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__image_generate` (double-underscore for provider compat)
 *   - EFFECT_TYPED: effect is `external_side_effect` (generates content via external API)
 *   - REDACTION_REQUIRED: imageBase64 stripped from redacted output; only mimeType/model/prompt exposed
 *   - ARTIFACT_BYTES_NEVER_IN_STATE: base64 goes to ArtifactSinkPort via onFullResult hook
 *   - NO LangChain imports (LangChain wrapping in langgraph-graphs)
 * Side-effects: IO (HTTP requests to image generation backend via capability)
 * Links: task.0163, TOOL_USE_SPEC.md
 * @public
 */

import { z } from "zod";

import type { ImageGenerateCapability } from "../capabilities/image-generate";
import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input schema for image generate tool.
 */
export const ImageGenerateInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(4000)
    .describe("A detailed description of the image to generate"),
  model: z
    .string()
    .optional()
    .describe(
      "Optional model override (e.g., 'google/gemini-2.0-flash-exp:free'). Uses default if omitted."
    ),
});
export type ImageGenerateInput = z.infer<typeof ImageGenerateInputSchema>;

/**
 * Output schema for image generate tool.
 * Contains base64 image data — this is the pre-redaction output.
 */
export const ImageGenerateOutputSchema = z.object({
  prompt: z.string().describe("The prompt used to generate the image"),
  model: z.string().describe("The model that generated the image"),
  mimeType: z.string().describe("MIME type of the generated image"),
  imageBase64: z.string().describe("Base64-encoded image bytes"),
});
export type ImageGenerateOutput = z.infer<typeof ImageGenerateOutputSchema>;

/**
 * Redacted output (imageBase64 stripped).
 * Per REDACTION_REQUIRED: Only safe fields exposed to LLM/UI.
 */
export type ImageGenerateRedacted = Omit<ImageGenerateOutput, "imageBase64">;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Namespaced tool ID per TOOL_ID_NAMESPACED invariant.
 */
export const IMAGE_GENERATE_NAME = "core__image_generate" as const;

export const imageGenerateContract: ToolContract<
  typeof IMAGE_GENERATE_NAME,
  ImageGenerateInput,
  ImageGenerateOutput,
  ImageGenerateRedacted
> = {
  name: IMAGE_GENERATE_NAME,
  description:
    "Generate an image from a text description. Returns image metadata. " +
    "Use detailed, descriptive prompts for best results.",
  effect: "external_side_effect",
  inputSchema: ImageGenerateInputSchema,
  outputSchema: ImageGenerateOutputSchema,

  redact: (output: ImageGenerateOutput): ImageGenerateRedacted => {
    // Strip imageBase64 — only safe metadata exposed
    const { imageBase64: _stripped, ...safe } = output;
    return safe;
  },

  allowlist: ["mimeType", "model", "prompt"] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dependencies for image generate implementation.
 * Per AUTH_VIA_CAPABILITY_INTERFACE: Auth resolved via capability.
 */
export interface ImageGenerateDeps {
  imageGenerateCapability: ImageGenerateCapability;
}

/**
 * Create image generate implementation with injected dependencies.
 * Per capability pattern: implementation receives capability at construction.
 */
export function createImageGenerateImplementation(
  deps: ImageGenerateDeps
): ToolImplementation<ImageGenerateInput, ImageGenerateOutput> {
  return {
    execute: async (
      input: ImageGenerateInput
    ): Promise<ImageGenerateOutput> => {
      const result = await deps.imageGenerateCapability.generate({
        prompt: input.prompt,
        model: input.model,
      });

      return {
        prompt: input.prompt,
        model: result.model,
        mimeType: result.mimeType,
        imageBase64: result.imageBase64,
      };
    },
  };
}

/**
 * Stub implementation that throws when image generate capability is not configured.
 * Used as default placeholder in catalog.
 */
export const imageGenerateStubImplementation: ToolImplementation<
  ImageGenerateInput,
  ImageGenerateOutput
> = {
  execute: async (): Promise<ImageGenerateOutput> => {
    throw new Error(
      "ImageGenerateCapability not configured. LiteLLM with an image model is required."
    );
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool (contract + stub implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bound tool with stub implementation.
 * Real implementation injected at runtime via createImageGenerateImplementation.
 */
export const imageGenerateBoundTool: BoundTool<
  typeof IMAGE_GENERATE_NAME,
  ImageGenerateInput,
  ImageGenerateOutput,
  ImageGenerateRedacted
> = {
  contract: imageGenerateContract,
  implementation: imageGenerateStubImplementation,
};
