// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core/enrichers/work-item-linker`
 * Purpose: Pure functions for extracting work-item IDs from GitHub event metadata and building artifact payloads.
 * Scope: Link extraction regex, artifact payload construction. Does not perform I/O or hold state.
 * Invariants:
 * - ENRICHER_SNAPSHOT_RULE: All external data must be snapshotted into the artifact payload.
 * - INPUTS_HASH_COMPLETE: inputs_hash covers epoch_id, sorted (event_id, event_payload_hash), sorted (work_item_id, frontmatter_hash). NOT repoCommitSha.
 * Side-effects: none
 * Links: work/items/task.0113.epoch-artifact-pipeline.md
 * @public
 */

/** A detected link between an event and a work item. */
export interface WorkItemLink {
  readonly workItemId: string;
  readonly linkSource: "title" | "body" | "branch" | "label";
}

/** Snapshotted frontmatter for a work item. */
export interface WorkItemSnapshot {
  readonly estimate: number | null;
  readonly priority: number | null;
  readonly status: string | null;
  readonly title: string | null;
  readonly frontmatterHash: string;
  readonly error?: "file_not_found" | "parse_error";
}

/** Full artifact payload for cogni.work_item_links.v0. */
export interface WorkItemLinksPayload {
  readonly repoCommitSha: string;
  readonly workItems: Record<string, WorkItemSnapshot>;
  readonly eventLinks: Record<string, WorkItemLink[]>;
  readonly unlinkedEventIds: string[];
}

/** Pattern: (task|bug|spike|story).\d{4} */
const WORK_ITEM_ID_PATTERN = /\b(task|bug|spike|story)\.\d{4}\b/g;

/**
 * Extract work-item IDs from event metadata fields.
 * Scans title, body, branch, and labels for patterns like task.0102, bug.0037, etc.
 *
 * @param metadata - Event metadata bag (may have title, body, branch, labels)
 * @returns Array of unique links with source attribution
 */
export function extractWorkItemIds(
  metadata: Partial<{
    title: string;
    body: string;
    branch: string;
    labels: string[];
  }> | null
): WorkItemLink[] {
  if (!metadata) return [];

  const seen = new Set<string>();
  const links: WorkItemLink[] = [];

  const scan = (
    text: string | undefined | null,
    source: WorkItemLink["linkSource"]
  ): void => {
    if (!text) return;
    for (const match of text.matchAll(WORK_ITEM_ID_PATTERN)) {
      const id = match[0];
      const key = `${id}:${source}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ workItemId: id, linkSource: source });
      }
    }
  };

  scan(metadata.title, "title");
  scan(metadata.body, "body");
  scan(metadata.branch, "branch");
  if (metadata.labels) {
    for (const label of metadata.labels) {
      scan(label, "label");
    }
  }

  return links;
}

/** Namespaced artifact ref for the work-item linker. */
export const WORK_ITEM_LINKS_ARTIFACT_REF = "cogni.work_item_links.v0";

/** Algorithm ref for the work-item linker enricher. */
export const WORK_ITEM_LINKER_ALGO_REF = "work-item-linker-v0";
