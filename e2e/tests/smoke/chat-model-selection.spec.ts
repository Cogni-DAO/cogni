// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@e2e/smoke/chat-model-selection`
 * Purpose: Validates end-to-end model selection flow in chat interface with persistence.
 * Scope: Tests model picker interaction, selection, and localStorage persistence. Does not test actual LLM calls or billing.
 * Invariants: Selected model persists across page reloads via localStorage.
 * Side-effects: IO, time, global
 * Notes: Only E2E test for model selection - validates critical user flow end-to-end.
 * Links: src/features/ai/components/ModelPicker.tsx, src/app/(app)/chat/page.tsx
 * @internal
 */

import { expect, test } from "@playwright/test";

// /chat requires authentication — redirects to / without a session.
// Skip in smoke (no auth context). Move to authenticated E2E suite when available.
test.describe.skip("Model Selection E2E", () => {
  test.beforeEach(async ({ page }) => {
    // Mock /api/v1/ai/models endpoint with fixture data
    await page.route("**/api/v1/ai/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            { id: "qwen3-4b", name: "Qwen 3 4B (Free)", isFree: true },
            { id: "gpt-4o-mini", name: "GPT-4O Mini", isFree: false },
            { id: "claude-3-haiku", name: "Claude 3 Haiku", isFree: false },
          ],
          defaultModelId: "gpt-4o-mini",
        }),
      });
    });
  });

  test("user can select model and selection persists on reload", async ({
    page,
  }) => {
    // Navigate to chat page
    await page.goto("/chat");

    // Verify default model displayed
    const modelTrigger = page.getByRole("button", { name: /select model/i });
    await expect(modelTrigger).toBeVisible();
    await expect(modelTrigger).toContainText("GPT-4O Mini");

    // Open model picker dialog
    await modelTrigger.click();

    // Select different model (Qwen 3 4B)
    const qwenOption = page.getByRole("button", { name: /Qwen 3 4B/i });
    await expect(qwenOption).toBeVisible();
    await qwenOption.click();

    // Verify selection updated in UI
    await expect(modelTrigger).toContainText("Qwen 3 4B");

    // Reload page to test persistence
    await page.reload();

    // Verify selection persisted via localStorage
    await expect(async () => {
      const triggerText = await modelTrigger.textContent();
      expect(triggerText).toContain("Qwen 3 4B");
    }).toPass();
  });
});
