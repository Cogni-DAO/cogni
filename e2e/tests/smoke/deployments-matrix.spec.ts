// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@e2e/smoke/deployments-matrix`
 * Purpose: Smoke test for deployment matrix page — verifies page loads and matrix renders.
 * Scope: Checks route reachability, matrix table presence, data source indicators. Does not validate data accuracy.
 * Invariants: /deployments route exists and renders matrix structure.
 * Side-effects: IO
 * Links: nodes/operator/app/src/app/(app)/deployments/view.tsx
 * @internal
 */

import { expect, test } from "@playwright/test";

test("[smoke] deployment matrix page loads and renders matrix", async ({
  page,
}) => {
  const response = await page.goto("/deployments");
  expect(response?.status()).toBeLessThan(400);

  // Page title visible
  await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();

  // Matrix card renders
  await expect(page.getByText("Environment Matrix")).toBeVisible();

  // Recent runs card renders
  await expect(page.getByText("Recent Runs")).toBeVisible();
});

test("[smoke] deployment matrix shows data source indicators", async ({
  page,
}) => {
  await page.goto("/deployments");

  // Data source indicators should be present (connected or not)
  await expect(page.getByText("GitHub")).toBeVisible();
  await expect(page.getByText("Loki")).toBeVisible();
  await expect(page.getByText("Health")).toBeVisible();
});

test("[smoke] deployment matrix table has environment rows", async ({
  page,
}) => {
  await page.goto("/deployments");

  // Wait for data to load (matrix table or empty state)
  await page.waitForSelector("table, text=No deployment data available", {
    timeout: 15_000,
  });

  // If table rendered, check for branch column headers
  const table = page.locator("table").first();
  if (await table.isVisible()) {
    await expect(table.getByText("Branch")).toBeVisible();
    await expect(table.getByText("CI")).toBeVisible();
    await expect(table.getByText("Health")).toBeVisible();
  }
});
