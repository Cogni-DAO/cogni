// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/capabilities/image-generate`
 * Purpose: Image generation capability interface for AI tool execution.
 * Scope: Defines ImageGenerateCapability for image generation. Does NOT implement transport.
 * Invariants:
 *   - NO_SECRETS_IN_CONTEXT: Capability resolves auth, never stored in context
 *   - ARTIFACT_BYTES_NEVER_IN_STATE: Raw bytes handled by capability, not LangGraph state
 * Side-effects: none (interface only)
 * Links: task.0163, TOOL_USE_SPEC.md
 * @public
 */

/**
 * Parameters for image generation.
 */
export interface ImageGenerateParams {
  /** The prompt describing the image to generate */
  readonly prompt: string;
  /** Optional model override (e.g., "google/gemini-2.0-flash-exp:free") */
  readonly model?: string;
}

/**
 * Result from image generation.
 */
export interface ImageGenerateResult {
  /** Base64-encoded image bytes */
  readonly imageBase64: string;
  /** MIME type of the generated image (e.g., "image/png") */
  readonly mimeType: string;
  /** Model that generated the image */
  readonly model: string;
}

/**
 * Image generation capability for AI tools.
 *
 * Per AUTH_VIA_CAPABILITY_INTERFACE:
 * Auth is resolved by the capability implementation, not passed in context.
 *
 * Implementations route through LiteLLM for billing/observability.
 */
export interface ImageGenerateCapability {
  /**
   * Generate an image from a text prompt.
   *
   * @param params - Generation parameters (prompt, optional model)
   * @returns Result with base64 image, MIME type, and model used
   * @throws If generation fails or API is unavailable
   */
  generate(params: ImageGenerateParams): Promise<ImageGenerateResult>;
}
