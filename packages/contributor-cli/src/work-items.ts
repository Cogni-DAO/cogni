// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/contributor-cli/work-items`
 * Purpose: Work item frontmatter reader/writer for the contributor CLI.
 * Scope: Reads and writes YAML frontmatter in work/items/*.md files. Does not perform git operations.
 * Invariants: Frontmatter must round-trip cleanly through parse/stringify.
 * Side-effects: IO (reads/writes work item files)
 * Links: docs/spec/development-lifecycle.md
 * @internal
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface WorkItemSummary {
  id: string;
  type: string;
  title: string;
  status: string;
  priority: number;
  assignees: string;
  branch: string;
  pr: string;
  project: string;
  labels: string[];
  file: string;
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return null;
  return parseYaml(match[1]) as Record<string, unknown>;
}

function replaceFrontmatter(
  content: string,
  fm: Record<string, unknown>
): string {
  return content.replace(
    /^---\n[\s\S]*?\n---/,
    `---\n${stringifyYaml(fm).trim()}\n---`
  );
}

export function findWorkItemsDir(): string {
  // Walk up from cwd to find work/items/
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    try {
      const items = join(dir, "work", "items");
      readdirSync(items);
      return items;
    } catch {
      dir = join(dir, "..");
    }
  }
  throw new Error(
    "Cannot find work/items/ directory. Are you in a Cogni repo?"
  );
}

export function listActionableItems(itemsDir: string): WorkItemSummary[] {
  const files = readdirSync(itemsDir).filter(
    (f) => /^(task|bug|spike)\.\d{4}\./.test(f) && f.endsWith(".md")
  );

  const actionableStatuses = [
    "needs_triage",
    "needs_research",
    "needs_design",
    "needs_implement",
    "needs_closeout",
    "needs_merge",
  ];

  const statusWeight: Record<string, number> = {
    needs_merge: 6,
    needs_closeout: 5,
    needs_implement: 4,
    needs_design: 3,
    needs_research: 2,
    needs_triage: 1,
  };

  return files
    .map((f) => {
      const content = readFileSync(join(itemsDir, f), "utf8");
      const fm = parseFrontmatter(content);
      if (!fm) return null;
      const status = String(fm.status ?? "");
      if (!actionableStatuses.includes(status)) return null;
      const rawLabels = fm.labels;
      const labels: string[] = Array.isArray(rawLabels)
        ? rawLabels.map(String)
        : typeof rawLabels === "string"
          ? rawLabels.split(",").map((s: string) => s.trim())
          : [];
      return {
        id: String(fm.id ?? ""),
        type: String(fm.type ?? ""),
        title: String(fm.title ?? "").slice(0, 60),
        status,
        priority: Number(fm.priority ?? 99),
        assignees: String(fm.assignees ?? ""),
        branch: String(fm.branch ?? ""),
        pr: String(fm.pr ?? ""),
        project: String(fm.project ?? ""),
        labels,
        file: f,
      };
    })
    .filter((x): x is WorkItemSummary => x !== null)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return (statusWeight[b.status] ?? 0) - (statusWeight[a.status] ?? 0);
    });
}

export function readWorkItem(
  itemsDir: string,
  taskId: string
): { fm: Record<string, unknown>; content: string; file: string } | null {
  const files = readdirSync(itemsDir).filter((f) => f.startsWith(`${taskId}.`));
  if (files.length === 0) return null;
  const file = files[0];
  if (!file) return null;
  const content = readFileSync(join(itemsDir, file), "utf8");
  const fm = parseFrontmatter(content);
  if (!fm) return null;
  return { fm, content, file };
}

export function updateWorkItem(
  itemsDir: string,
  file: string,
  updates: Record<string, unknown>
): void {
  const path = join(itemsDir, file);
  const content = readFileSync(path, "utf8");
  const fm = parseFrontmatter(content);
  if (!fm) throw new Error(`Cannot parse frontmatter in ${file}`);
  Object.assign(fm, updates);
  fm.updated = new Date().toISOString().split("T")[0];
  writeFileSync(path, replaceFrontmatter(content, fm));
}
