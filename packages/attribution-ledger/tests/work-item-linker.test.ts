// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-ledger/tests/work-item-linker`
 * Purpose: Unit tests for work-item ID extraction from event metadata.
 * Scope: Tests extractWorkItemIds regex patterns and deduplication. Does not test I/O or store.
 * Invariants: Pattern matches (task|bug|spike|story).\d{4} with word boundaries.
 * Side-effects: none
 * Links: packages/attribution-ledger/src/enrichers/work-item-linker.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import { extractWorkItemIds } from "../src/enrichers/work-item-linker";

describe("extractWorkItemIds", () => {
  it("extracts task ID from title", () => {
    const links = extractWorkItemIds({ title: "fix: resolve task.0102 crash" });
    expect(links).toEqual([{ workItemId: "task.0102", linkSource: "title" }]);
  });

  it("extracts bug ID from body", () => {
    const links = extractWorkItemIds({
      body: "This fixes bug.0037 and also relates to bug.0038",
    });
    expect(links).toEqual([
      { workItemId: "bug.0037", linkSource: "body" },
      { workItemId: "bug.0038", linkSource: "body" },
    ]);
  });

  it("extracts spike and story IDs", () => {
    const links = extractWorkItemIds({
      title: "spike.0001 research",
      body: "story.9999 epic",
    });
    expect(links).toEqual([
      { workItemId: "spike.0001", linkSource: "title" },
      { workItemId: "story.9999", linkSource: "body" },
    ]);
  });

  it("extracts from branch name", () => {
    const links = extractWorkItemIds({
      branch: "feat/task.0113-artifact-pipeline",
    });
    expect(links).toEqual([{ workItemId: "task.0113", linkSource: "branch" }]);
  });

  it("extracts from labels", () => {
    const links = extractWorkItemIds({
      labels: ["task.0102", "priority:high", "bug.0037"],
    });
    expect(links).toEqual([
      { workItemId: "task.0102", linkSource: "label" },
      { workItemId: "bug.0037", linkSource: "label" },
    ]);
  });

  it("deduplicates same ID from same source", () => {
    const links = extractWorkItemIds({
      title: "task.0102 and task.0102 again",
    });
    expect(links).toEqual([{ workItemId: "task.0102", linkSource: "title" }]);
  });

  it("allows same ID from different sources", () => {
    const links = extractWorkItemIds({
      title: "task.0102",
      body: "relates to task.0102",
    });
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({ workItemId: "task.0102", linkSource: "title" });
    expect(links[1]).toEqual({ workItemId: "task.0102", linkSource: "body" });
  });

  it("returns empty array for null metadata", () => {
    expect(extractWorkItemIds(null)).toEqual([]);
  });

  it("returns empty array for metadata with no matches", () => {
    const links = extractWorkItemIds({
      title: "refactor: clean up code",
      body: "No work items here",
    });
    expect(links).toEqual([]);
  });

  it("does not match partial patterns", () => {
    const links = extractWorkItemIds({
      title: "xtask.0102 and task.01 and task.00001",
    });
    // task.0102 is preceded by 'x' but \b matches at word boundary of 'task'
    // Actually 'xtask' has no word boundary before 'task' — x is a word char
    // task.01 has only 2 digits, not 4
    // task.00001 has 5 digits — \d{4} matches first 4, but \b after won't match
    // because the 5th digit is still a word character
    expect(links).toEqual([]);
  });

  it("matches IDs embedded in longer text", () => {
    const links = extractWorkItemIds({
      title: "PR for (task.0102) review",
    });
    expect(links).toEqual([{ workItemId: "task.0102", linkSource: "title" }]);
  });
});
