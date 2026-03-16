// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/repo-spec/rules`
 * Purpose: Pure parsing for .cogni/rules/*.yaml rule files.
 * Scope: Validates rule YAML against schema, returns typed result. Does not perform I/O.
 * Invariants: REPO_SPEC_AUTHORITY — single canonical parser for rule files.
 * Side-effects: none
 * Links: .cogni/rules/*.yaml
 * @public
 */

import { parse } from "yaml";

import { type Rule, ruleSchema } from "./schema.js";

/**
 * Parse and validate a rule YAML file.
 * Accepts raw YAML string or pre-parsed object.
 * Returns a fully validated Rule with defaults applied.
 */
export function parseRule(input: string | unknown): Rule {
  let parsed: unknown;

  if (typeof input === "string") {
    try {
      parsed = parse(input);
    } catch (error) {
      throw new Error(
        `[repo-spec] Failed to parse rule YAML: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    parsed = input;
  }

  const result = ruleSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `[repo-spec] Invalid rule structure: ${result.error.message}`
    );
  }

  return result.data;
}
