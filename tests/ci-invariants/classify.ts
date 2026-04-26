// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/ci-invariants/classify`
 * Purpose: Reference TypeScript implementation of the single-node-scope policy.
 *          Mirrors the bash logic in `.github/workflows/ci.yaml#single-node-scope`
 *          and is the surface task.0382's runtime resolver must match.
 * Scope: Pure function used by parity tests. Does NOT read the filesystem or invoke git.
 * Invariants: SINGLE_DOMAIN_HARD_FAIL, OPERATOR_IS_A_NODE, RIDE_ALONG (see work/items/task.0381.* §Invariants).
 * Side-effects: none
 * Notes: When task.0382 lands, it should import this same function (or replicate
 *        it identically) and run the same fixtures.
 * Links: tests/ci-invariants/fixtures/single-node-scope/, work/items/task.0382.*
 * @public
 */

export type Domain = "operator" | string;

export interface ClassifyResult {
  /** Distinct domains touched by the diff, post-exception. Sorted, lowercase. */
  domains: Domain[];
  /** True iff the gate would pass. */
  pass: boolean;
  /** Set when RIDE_ALONG bumped a 2-domain diff down to 1. */
  rideAlongApplied: boolean;
}

const NODES_PREFIX = "nodes/";
const OPERATOR_NODE = "operator";

/**
 * Operator-domain paths that may ride along a single non-operator node PR.
 * These are mechanical side-effects or cross-cutting node intent that lives
 * outside `nodes/<X>/` only because we have not yet migrated it (work items
 * → Dolt). Adding to this list weakens the gate; do so deliberately.
 *
 * - `pnpm-lock.yaml`: mechanical side-effect of node-level package.json edits.
 * - `work/items/**`: per-task work items; high merge-conflict + index-regen
 *   churn. Ride-along until task tracking moves to Dolt.
 */
const RIDE_ALONG_PATTERNS: ReadonlyArray<(p: string) => boolean> = [
  (p) => p === "pnpm-lock.yaml",
  (p) => p.startsWith("work/items/"),
];

function isRideAlong(path: string): boolean {
  return RIDE_ALONG_PATTERNS.some((m) => m(path));
}

/**
 * Classify a list of changed paths against the set of known non-operator nodes.
 * The rule:
 *   domain(path) = X         if path starts with `nodes/<X>/` for X in nonOperatorNodes
 *                = "operator" otherwise
 * Ride-along: if every operator-domain entry matches a RIDE_ALONG_PATTERNS
 * predicate and exactly one non-operator domain is also present, drop
 * "operator" from the set.
 */
export function classify(
  changedPaths: string[],
  nonOperatorNodes: string[]
): ClassifyResult {
  const nodes = new Set(nonOperatorNodes);
  const domains = new Set<Domain>();
  const operatorPaths: string[] = [];

  for (const p of changedPaths) {
    let assigned: Domain = OPERATOR_NODE;
    if (p.startsWith(NODES_PREFIX)) {
      const rest = p.slice(NODES_PREFIX.length);
      const slash = rest.indexOf("/");
      if (slash > 0) {
        const candidate = rest.slice(0, slash);
        if (nodes.has(candidate)) {
          assigned = candidate;
        }
      }
    }
    domains.add(assigned);
    if (assigned === OPERATOR_NODE) operatorPaths.push(p);
  }

  let rideAlongApplied = false;
  if (
    domains.size === 2 &&
    domains.has(OPERATOR_NODE) &&
    operatorPaths.length > 0 &&
    operatorPaths.every(isRideAlong)
  ) {
    domains.delete(OPERATOR_NODE);
    rideAlongApplied = true;
  }

  const sorted = [...domains].sort();
  return {
    domains: sorted,
    pass: sorted.length <= 1,
    rideAlongApplied,
  };
}
