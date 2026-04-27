// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/ci-invariants/single-node-scope-parity`
 * Purpose: Asserts the reference single-node-scope classifier matches every fixture's expected outcome.
 * Scope: Pure-data fixture replay backed by a reference classifier. Does NOT invoke the GitHub Action or shell out to git.
 * Invariants: POLICY_PARITY_WITH_0382, RIDE_ALONG, SINGLE_DOMAIN_HARD_FAIL.
 * Side-effects: IO (reads fixture JSON + nodes/ listing)
 * Notes: Fixtures are the shared source of truth. When task.0382 imports
 *        `classify` (or implements its equivalent), it should run against
 *        the same fixtures and the it.todo cases below should be filled in.
 * Links: tests/ci-invariants/classify.ts, work/items/task.0382.*
 * @public
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractOwningNode, type OwningNode } from "@cogni/repo-spec";
import { buildTestRepoSpec, TEST_NODE_ENTRIES } from "@cogni/repo-spec/testing";
import { describe, expect, it } from "vitest";
import { type ClassifyResult, classify } from "./classify";

const REPO_ROOT = path.resolve(__dirname, "../..");
const FIXTURES_DIR = path.join(__dirname, "fixtures/single-node-scope");
const NODES_DIR = path.join(REPO_ROOT, "nodes");
const OPERATOR_NODE = "operator";

interface Fixture {
  name: string;
  paths: string[];
  expected: ClassifyResult;
}

function loadFixtures(): Array<{ file: string; data: Fixture }> {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({
      file,
      data: JSON.parse(
        readFileSync(path.join(FIXTURES_DIR, file), "utf8")
      ) as Fixture,
    }));
}

function nonOperatorNodes(): string[] {
  return readdirSync(NODES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== OPERATOR_NODE)
    .map((d) => d.name)
    .sort();
}

describe("single-node-scope · CI gate side (reference classifier)", () => {
  const fixtures = loadFixtures();
  const nodes = nonOperatorNodes();

  expect(fixtures.length, "at least one fixture must exist").toBeGreaterThan(0);

  for (const { file, data } of fixtures) {
    it(`${file}: ${data.name}`, () => {
      const result = classify(data.paths, nodes);
      expect(result).toEqual(data.expected);
    });
  }
});

/**
 * Translate `OwningNode` → `ClassifyResult`. The bash gate speaks domain *names*
 * (`"poly"`, `"operator"`); the resolver speaks `nodeId` UUIDs. Domain name is the
 * second segment of the registry entry's `path` (`nodes/poly` → `"poly"`).
 */
function toClassifyResult(o: OwningNode): ClassifyResult {
  if (o.kind === "miss") {
    return { domains: [], pass: true, rideAlongApplied: false };
  }
  if (o.kind === "single") {
    const name = o.path.split("/")[1] ?? "";
    return {
      domains: [name],
      pass: true,
      rideAlongApplied: o.rideAlongApplied === true,
    };
  }
  const names = o.nodes.map((n) => n.path.split("/")[1] ?? "").sort();
  return { domains: names, pass: false, rideAlongApplied: false };
}

describe("single-node-scope · runtime resolver side (task.0382)", () => {
  const fixtures = loadFixtures();

  // Test registry mirrors the on-disk nodes/ listing. extractOwningNode requires
  // the operator entry to be present (meta-test invariant).
  const spec = buildTestRepoSpec({
    nodes: [
      TEST_NODE_ENTRIES.operator,
      TEST_NODE_ENTRIES.poly,
      TEST_NODE_ENTRIES.resy,
      // node-template exists in nodes/ but is not referenced by any current fixture.
      {
        node_id: "00000000-0000-4000-8000-0000000000aa",
        node_name: "Node Template",
        path: "nodes/node-template",
      },
    ],
  });

  for (const { file, data } of fixtures) {
    it(`${file}: ${data.name}`, () => {
      const result = toClassifyResult(extractOwningNode(spec, data.paths));
      expect(result).toEqual(data.expected);
    });
  }
});
