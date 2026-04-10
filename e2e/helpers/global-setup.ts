// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@e2e/helpers/global-setup`
 * Purpose: Global setup for Playwright tests - environment validation and health checks.
 * Scope: Runs once before all tests; validates target URLs are reachable; does not run tests or modify application state.
 * Invariants: Must ensure test target is healthy before running tests.
 * Side-effects: IO, time, global
 * Notes: Used by playwright.config.ts globalSetup option.
 * Links: playwright.config.ts
 * @internal
 */

import type { FullConfig } from "@playwright/test";

export async function globalSetup(cfg: FullConfig): Promise<void> {
  const isCi = !!process.env.CI;
  const BASE_URL = process.env.TEST_BASE_URL;
  const ENABLE_PROD = process.env.E2E_ENABLE_PROD;
  const HEALTHCHECK_PATH = process.env.E2E_HEALTHCHECK_PATH ?? "/api/auth/csrf";

  console.log("🎭 Playwright Global Setup");
  console.log(`Environment: ${isCi ? "CI" : "Local"}`);

  const anyProject = cfg.projects[0];
  const baseUrl = (anyProject?.use?.baseURL as string | undefined) ?? BASE_URL;

  if (baseUrl) {
    console.log(`Base URL: ${baseUrl}`);
    const healthcheckUrl = new URL(HEALTHCHECK_PATH, baseUrl).toString();
    console.log(`Healthcheck URL: ${healthcheckUrl}`);

    // Health check the target URL
    try {
      const res = await fetch(healthcheckUrl);
      if (!res.ok) {
        throw new Error(`Target not healthy: ${healthcheckUrl} (${res.status})`);
      }
      console.log(`✅ Target healthy: ${healthcheckUrl}`);
    } catch (error) {
      throw new Error(`Target not reachable: ${healthcheckUrl} - ${error}`);
    }
  }

  // Guard prod tests
  if (ENABLE_PROD) {
    console.log("🚨 Production tests enabled");
  }

  // Validate environment in CI
  if (isCi && !BASE_URL) {
    throw new Error("CI environment requires TEST_BASE_URL");
  }
}
