// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tests/image-generate`
 * Purpose: Unit tests for image_generate tool contract and implementation.
 * Scope: Tests contract shape, input validation, output validation, redaction, and execution; does not make network calls.
 * Invariants: No network/LLM calls; capability is mocked.
 * Side-effects: none
 * Links: src/tools/image-generate.ts, task.0163
 * @internal
 */

import { describe, expect, it, vi } from "vitest";

import type { ImageGenerateCapability } from "../src/capabilities/image-generate";
import {
  createImageGenerateImplementation,
  IMAGE_GENERATE_NAME,
  ImageGenerateInputSchema,
  ImageGenerateOutputSchema,
  imageGenerateBoundTool,
  imageGenerateContract,
  imageGenerateStubImplementation,
} from "../src/tools/image-generate";

describe("image_generate contract", () => {
  it("has correct namespaced name", () => {
    expect(imageGenerateContract.name).toBe("core__image_generate");
    expect(IMAGE_GENERATE_NAME).toBe("core__image_generate");
  });

  it("has description for LLM", () => {
    expect(imageGenerateContract.description).toBeDefined();
    expect(imageGenerateContract.description.length).toBeGreaterThan(10);
  });

  it("has effect external_side_effect", () => {
    expect(imageGenerateContract.effect).toBe("external_side_effect");
  });

  it("has allowlist without imageBase64", () => {
    expect(imageGenerateContract.allowlist).toContain("mimeType");
    expect(imageGenerateContract.allowlist).toContain("model");
    expect(imageGenerateContract.allowlist).toContain("prompt");
    expect(imageGenerateContract.allowlist).not.toContain("imageBase64");
  });

  describe("inputSchema", () => {
    it("accepts valid prompt", () => {
      const result = ImageGenerateInputSchema.parse({
        prompt: "a cat wearing a hat",
      });
      expect(result.prompt).toBe("a cat wearing a hat");
      expect(result.model).toBeUndefined();
    });

    it("accepts prompt with model override", () => {
      const result = ImageGenerateInputSchema.parse({
        prompt: "a sunset over mountains",
        model: "google/gemini-2.0-flash-exp:free",
      });
      expect(result.model).toBe("google/gemini-2.0-flash-exp:free");
    });

    it("rejects empty prompt", () => {
      expect(() => ImageGenerateInputSchema.parse({ prompt: "" })).toThrow();
    });

    it("rejects missing prompt", () => {
      expect(() => ImageGenerateInputSchema.parse({})).toThrow();
    });

    it("rejects prompt over 4000 chars", () => {
      expect(() =>
        ImageGenerateInputSchema.parse({ prompt: "x".repeat(4001) })
      ).toThrow();
    });
  });

  describe("outputSchema", () => {
    it("accepts valid output with all fields", () => {
      const result = ImageGenerateOutputSchema.parse({
        prompt: "a cat",
        model: "gemini-2.0-flash",
        mimeType: "image/png",
        imageBase64: "iVBORw0KGgo=",
      });
      expect(result.mimeType).toBe("image/png");
      expect(result.imageBase64).toBe("iVBORw0KGgo=");
    });

    it("rejects missing imageBase64", () => {
      expect(() =>
        ImageGenerateOutputSchema.parse({
          prompt: "a cat",
          model: "gemini",
          mimeType: "image/png",
        })
      ).toThrow();
    });
  });

  describe("redact", () => {
    it("strips imageBase64 from output", () => {
      const output = {
        prompt: "a cat",
        model: "gemini-2.0-flash",
        mimeType: "image/png",
        imageBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA",
      };
      const redacted = imageGenerateContract.redact(output);
      expect(redacted).toEqual({
        prompt: "a cat",
        model: "gemini-2.0-flash",
        mimeType: "image/png",
      });
      expect("imageBase64" in redacted).toBe(false);
    });
  });
});

describe("image_generate implementation", () => {
  const mockCapability: ImageGenerateCapability = {
    generate: vi.fn().mockResolvedValue({
      imageBase64: "dGVzdA==",
      mimeType: "image/png",
      model: "gemini-2.0-flash",
    }),
  };

  it("calls capability and returns structured output", async () => {
    const impl = createImageGenerateImplementation({
      imageGenerateCapability: mockCapability,
    });
    const result = await impl.execute({ prompt: "a happy dog" });

    expect(mockCapability.generate).toHaveBeenCalledWith({
      prompt: "a happy dog",
      model: undefined,
    });
    expect(result).toEqual({
      prompt: "a happy dog",
      model: "gemini-2.0-flash",
      mimeType: "image/png",
      imageBase64: "dGVzdA==",
    });
  });

  it("output passes schema validation", async () => {
    const impl = createImageGenerateImplementation({
      imageGenerateCapability: mockCapability,
    });
    const result = await impl.execute({ prompt: "test" });
    expect(() => ImageGenerateOutputSchema.parse(result)).not.toThrow();
  });

  it("stub implementation throws", async () => {
    await expect(
      imageGenerateStubImplementation.execute({ prompt: "test" })
    ).rejects.toThrow("ImageGenerateCapability not configured");
  });
});

describe("image_generate bound tool", () => {
  it("has both contract and implementation", () => {
    expect(imageGenerateBoundTool.contract).toBe(imageGenerateContract);
    expect(imageGenerateBoundTool.implementation).toBe(
      imageGenerateStubImplementation
    );
  });
});
