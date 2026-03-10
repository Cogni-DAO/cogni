// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/langgraph-graphs/graphs/pr-review/graph`
 * Purpose: Unit tests for PR review graph factory and prompt builder.
 * Scope: Graph creation + prompt formatting. Does not make LLM calls.
 * Invariants: Graph factory is pure; prompt builder produces valid user messages.
 * Side-effects: none
 * Links: packages/langgraph-graphs/src/graphs/pr-review/
 * @public
 */

import { describe, expect, it } from "vitest";

import { LANGGRAPH_CATALOG } from "../../../src/catalog";
import { PR_REVIEW_GRAPH_NAME } from "../../../src/graphs/pr-review/graph";
import { buildReviewUserMessage } from "../../../src/graphs/pr-review/prompts";

describe("PR Review Graph", () => {
  describe("catalog registration", () => {
    it("is registered in LANGGRAPH_CATALOG", () => {
      expect(LANGGRAPH_CATALOG[PR_REVIEW_GRAPH_NAME]).toBeDefined();
    });

    it("has empty toolIds", () => {
      const entry = LANGGRAPH_CATALOG[PR_REVIEW_GRAPH_NAME];
      expect(entry?.toolIds).toEqual([]);
    });

    it("has a valid graph factory", () => {
      const entry = LANGGRAPH_CATALOG[PR_REVIEW_GRAPH_NAME];
      expect(typeof entry?.graphFactory).toBe("function");
    });
  });

  describe("graph name", () => {
    it("is 'pr-review'", () => {
      expect(PR_REVIEW_GRAPH_NAME).toBe("pr-review");
    });
  });
});

describe("buildReviewUserMessage", () => {
  it("includes PR title and body", () => {
    const msg = buildReviewUserMessage({
      prTitle: "feat: add widget",
      prBody: "Adds a new widget component",
      diffSummary: "diff here",
      evaluations: [{ metric: "test", prompt: "Is this good?" }],
    });

    expect(msg).toContain("feat: add widget");
    expect(msg).toContain("Adds a new widget component");
  });

  it("includes diff summary", () => {
    const msg = buildReviewUserMessage({
      prTitle: "fix: bug",
      prBody: "",
      diffSummary: "+++ added line\n--- removed line",
      evaluations: [{ metric: "test", prompt: "Is this good?" }],
    });

    expect(msg).toContain("+++ added line");
    expect(msg).toContain("--- removed line");
  });

  it("includes all evaluation metrics", () => {
    const msg = buildReviewUserMessage({
      prTitle: "test",
      prBody: "",
      diffSummary: "diff",
      evaluations: [
        { metric: "coherent-change", prompt: "Is this PR coherent?" },
        { metric: "non-malicious", prompt: "Is this safe?" },
      ],
    });

    expect(msg).toContain("**coherent-change**");
    expect(msg).toContain("**non-malicious**");
    expect(msg).toContain("Is this PR coherent?");
    expect(msg).toContain("Is this safe?");
  });

  it("handles empty body gracefully", () => {
    const msg = buildReviewUserMessage({
      prTitle: "test",
      prBody: "",
      diffSummary: "diff",
      evaluations: [{ metric: "test", prompt: "prompt" }],
    });

    expect(msg).toContain("(no description)");
  });
});
