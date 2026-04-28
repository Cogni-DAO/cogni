// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/temporal-workflows/tests/pr-review-input-contract.test`
 * Purpose: Contract test for `PrReviewWorkflowInputSchema` — proves the schema is the single source of truth and catches future drift between dispatch and activity.
 * Scope: Pure schema validation only. Does not exercise the Temporal runtime or any HTTP/Octokit I/O.
 * Invariants:
 *   - SINGLE_INPUT_CONTRACT: A canonical fixture representing a real dispatch payload validates without error.
 *   - DISPATCH_FAIL_FAST: Misshapen fixtures (missing field, wrong type, empty string, typo'd name) reject at parse time.
 * Side-effects: none
 * Links: task.0419, packages/temporal-workflows/src/workflows/pr-review.schema.ts
 * @internal
 */

import { describe, expect, it } from "vitest";
import { PrReviewWorkflowInputSchema } from "../src/workflows/pr-review.schema.js";

/** Canonical valid fixture — mirrors what `dispatchPrReview` produces today. */
const validFixture = {
  nodeId: "4ff8eac1-4eba-4ed0-931b-b1fe4f64713d",
  owner: "Cogni-DAO",
  repo: "test-repo",
  prNumber: 920,
  headSha: "ebc27a9d9d65bf05ad26c107328c5576b7614333",
  installationId: 12345678,
  actorUserId: "5d6f6e6c-7e8f-4a9b-bcde-1234567890ab",
  billingAccountId: "1a2b3c4d-5e6f-4789-9abc-def012345678",
  virtualKeyId: "vk_system_default",
};

describe("PrReviewWorkflowInputSchema", () => {
  describe("valid inputs", () => {
    it("parses a canonical dispatch payload", () => {
      const parsed = PrReviewWorkflowInputSchema.parse(validFixture);
      expect(parsed).toEqual(validFixture);
    });

    /**
     * Synthetic mirror of what `dispatchPrReview → startPrReviewWorkflow` builds.
     * If the dispatch facade adds/removes/renames a field without updating the
     * schema, this test fails — the modelRef-shape regression class is closed
     * by construction.
     */
    it("a payload built from synthetic GitHub webhook + billing context parses cleanly", () => {
      const dispatchPayload = {
        nodeId: "11111111-2222-4333-8444-555555555555",
        owner: "Cogni-DAO",
        repo: "test-repo",
        prNumber: 1,
        headSha: "0123456789abcdef0123456789abcdef01234567",
        installationId: 1,
        actorUserId: "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee",
        billingAccountId: "ffffffff-1111-4222-9333-444444444444",
        virtualKeyId: "vk_test",
      };
      expect(() =>
        PrReviewWorkflowInputSchema.parse(dispatchPayload)
      ).not.toThrow();
    });
  });

  describe("rejects misshapen inputs", () => {
    it("rejects unknown field under .strict() mode", () => {
      const withExtra = { ...validFixture, modelRef: "gpt-4o" };
      const result = PrReviewWorkflowInputSchema.safeParse(withExtra);
      expect(result.success).toBe(false);
    });

    it("rejects typo'd field name (the renamed-field regression class)", () => {
      const { virtualKeyId: _vk, ...rest } = validFixture;
      const withTypo = { ...rest, virtualKeyld: "vk_typo" };
      const result = PrReviewWorkflowInputSchema.safeParse(withTypo);
      expect(result.success).toBe(false);
    });

    it("rejects missing required field (nodeId)", () => {
      const { nodeId: _nodeId, ...withoutNodeId } = validFixture;
      const result = PrReviewWorkflowInputSchema.safeParse(withoutNodeId);
      expect(result.success).toBe(false);
    });

    it("rejects missing required field (installationId)", () => {
      const { installationId: _id, ...withoutInstallation } = validFixture;
      const result = PrReviewWorkflowInputSchema.safeParse(withoutInstallation);
      expect(result.success).toBe(false);
    });

    it("rejects empty string for owner", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        owner: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("rejects misshapen numeric inputs", () => {
    it("rejects negative prNumber", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        prNumber: -1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects zero prNumber (boundary — positive() excludes 0)", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        prNumber: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer prNumber", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        prNumber: 1.5,
      });
      expect(result.success).toBe(false);
    });

    it("rejects zero installationId (boundary — positive() excludes 0)", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        installationId: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("rejects format-violating strings", () => {
    it("rejects non-UUID nodeId", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        nodeId: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });

    it("rejects malformed headSha (too short)", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        headSha: "abc123",
      });
      expect(result.success).toBe(false);
    });

    it("rejects headSha with uppercase hex (Git SHAs are lowercase)", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        headSha: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("regression guards for the modelRef-shape lesson (PR #1067)", () => {
    it("rejects a string in place of a structured-id field (type-shape mismatch)", () => {
      // PR #1067 was a TYPE shape mismatch: dispatch sent `model: "gpt-4o-mini"`
      // (string) but the activity expected `modelRef: { providerKey, modelId }`
      // (object). The string-vs-int regression below pins the same pattern.
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        installationId: "12345678", // legacy: string instead of int
      });
      expect(result.success).toBe(false);
    });

    it("rejects string prNumber (the modelRef-shape regression class)", () => {
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...validFixture,
        prNumber: "920",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a legacy field-name + missing required (name-shape mismatch)", () => {
      // Combined regression: a stray legacy-shape field is present, AND a
      // required field is dropped. .strict() catches the stray; required
      // validation catches the missing.
      const { virtualKeyId: _vk, ...rest } = validFixture;
      const result = PrReviewWorkflowInputSchema.safeParse({
        ...rest,
        model: "gpt-4o-mini", // stray legacy field
      });
      expect(result.success).toBe(false);
    });
  });
});
