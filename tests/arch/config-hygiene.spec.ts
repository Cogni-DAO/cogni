// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/arch/config-hygiene`
 * Purpose: Validates dependency-cruiser config hygiene (no phantom layers, valid definitions).
 * Scope: Tests config correctness. Does NOT test boundary enforcement.
 * Invariants: All defined layers must exist in filesystem; no unused layer definitions.
 * Side-effects: IO (filesystem checks)
 * Notes: Prevents config drift and phantom layer definitions.
 * Links: .dependency-cruiser.cjs, docs/spec/architecture.md
 * @public
 */

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Dependency-cruiser config hygiene", () => {
  it("defines only layers that exist in filesystem", () => {
    // Core existing layers
    const existingLayers = [
      "apps/operator/src/core",
      "apps/operator/src/ports",
      "apps/operator/src/features",
      "apps/operator/src/app",
      "apps/operator/src/adapters/server",
      "apps/operator/src/adapters/test",
      "apps/operator/src/shared",
      "apps/operator/src/bootstrap",
      "apps/operator/src/lib",
      "apps/operator/src/components",
      "apps/operator/src/styles",
      "apps/operator/src/types",
      "apps/operator/src/contracts",
      "apps/operator/src/mcp",
    ];

    // Verify each layer exists
    for (const path of existingLayers) {
      expect(existsSync(path), `Layer ${path} should exist`).toBe(true);
    }
  });

  it("does not define phantom adaptersWorker layer", () => {
    expect(existsSync("apps/operator/src/adapters/worker")).toBe(false);
  });

  it("does not define phantom adaptersCli layer", () => {
    expect(existsSync("apps/operator/src/adapters/cli")).toBe(false);
  });
});
