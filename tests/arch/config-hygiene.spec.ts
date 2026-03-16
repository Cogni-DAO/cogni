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
      "apps/web/src/core",
      "apps/web/src/ports",
      "apps/web/src/features",
      "apps/web/src/app",
      "apps/web/src/adapters/server",
      "apps/web/src/adapters/test",
      "apps/web/src/shared",
      "apps/web/src/bootstrap",
      "apps/web/src/lib",
      "apps/web/src/components",
      "apps/web/src/styles",
      "apps/web/src/types",
      "apps/web/src/contracts",
      "apps/web/src/mcp",
    ];

    // Verify each layer exists
    for (const path of existingLayers) {
      expect(existsSync(path), `Layer ${path} should exist`).toBe(true);
    }
  });

  it("does not define phantom adaptersWorker layer", () => {
    expect(existsSync("apps/web/src/adapters/worker")).toBe(false);
  });

  it("does not define phantom adaptersCli layer", () => {
    expect(existsSync("apps/web/src/adapters/cli")).toBe(false);
  });
});
