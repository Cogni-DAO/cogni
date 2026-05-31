// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: tests/unit/secrets-catalog-loader
 * Purpose: Unit-cover the capability-gated fan-out schema (appliesTo/shared)
 *   added in design.secrets-catalog-per-node §Amendment v2 (task.5094).
 * Scope: Pure loader behaviour against an in-tmpdir fixture catalog.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSecretsCatalog } from "../../scripts/lib/secrets-catalog-loader";

let repoRoot: string;

function writeOperatorCatalog(secretsYaml: string): void {
  mkdirSync(join(repoRoot, "infra"), { recursive: true });
  mkdirSync(join(repoRoot, "nodes"), { recursive: true });
  writeFileSync(
    join(repoRoot, "infra", "secrets-catalog.yaml"),
    `secrets:\n${secretsYaml}`
  );
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "cogni-catalog-"));
});
afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("secrets-catalog-loader · capability fan-out (v2)", () => {
  it("carries appliesTo + shared into the routing record", () => {
    writeOperatorCatalog(`
  - name: AUTH_SECRET
    tier: A1
    appliesTo: web
    required: true
    category: Core App
    source: agent
    description: NextAuth session key
    steps: ["auto"]
    generate: { kind: base64, bytes: 32 }
  - name: OPENROUTER_API_KEY
    tier: A1
    appliesTo: all-nodes
    shared: true
    required: true
    category: LLM
    source: human
    description: shared OpenRouter key
    steps: ["paste"]
`);
    const { routing } = loadSecretsCatalog({ repoRoot });
    expect(routing.AUTH_SECRET).toMatchObject({
      appliesTo: "web",
      shared: undefined,
    });
    expect(routing.OPENROUTER_API_KEY).toMatchObject({
      appliesTo: "all-nodes",
      shared: true,
    });
    // No name collision despite both being A1 baseline — declared once each.
    expect(routing.AUTH_SECRET.service).toBeUndefined();
  });

  it("rejects an entry that declares both service and appliesTo", () => {
    writeOperatorCatalog(`
  - name: AUTH_SECRET
    tier: A1
    service: _shared
    appliesTo: web
    required: true
    category: Core App
    source: agent
    description: conflicting routing
    steps: ["auto"]
    generate: { kind: base64, bytes: 32 }
`);
    expect(() => loadSecretsCatalog({ repoRoot })).toThrow(
      /mutually exclusive/
    );
  });
});
