// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@/lib/work-scanner`
 * Purpose: Scan work/ directory for .md files and parse YAML frontmatter into WorkItem objects.
 * Scope: Filesystem read-only. Does not modify any files or write to disk.
 * Invariants: MARKDOWN_READONLY — never writes to .md files.
 * Side-effects: IO (filesystem reads)
 * Links: [WorkPage](../app/(app)/work/page.tsx)
 * @public
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import YAML from "yaml";

export interface WorkItem {
  id: string;
  type: string;
  title: string;
  status: string;
  priority: number | undefined;
  estimate: number | undefined;
  summary: string;
  outcome: string;
  assignees: string[];
  labels: string[];
  created: string;
  updated: string;
  branch: string;
  path: string;
  project: string;
}

const SCAN_DIRS = ["work/items", "work/projects"];
const EXCLUDE_FILES = ["_index.md"];
const EXCLUDE_DIRS = ["_templates", "archive", ".git", "node_modules"];

function parseFrontmatter(raw: string): Record<string, unknown> | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return null;
  try {
    return YAML.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string" && val.length > 0)
    return val.split(",").map((s) => s.trim());
  return [];
}

function toNumber(val: unknown): number | undefined {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function toStr(val: unknown): string {
  if (val == null) return "";
  return String(val);
}

async function scanDir(
  baseDir: string,
  dir: string
): Promise<{ filePath: string; relPath: string }[]> {
  const results: { filePath: string; relPath: string }[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (EXCLUDE_DIRS.includes(entry.name)) continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await scanDir(baseDir, fullPath)));
    } else if (
      entry.name.endsWith(".md") &&
      !EXCLUDE_FILES.includes(entry.name)
    ) {
      results.push({
        filePath: fullPath,
        relPath: relative(baseDir, fullPath),
      });
    }
  }
  return results;
}

export async function getWorkItems(): Promise<WorkItem[]> {
  const projectRoot = process.cwd();
  const items: WorkItem[] = [];

  for (const scanDir_ of SCAN_DIRS) {
    const absDir = join(projectRoot, scanDir_);
    const files = await scanDir(projectRoot, absDir);

    for (const { filePath, relPath } of files) {
      let raw: string;
      try {
        raw = await readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const fm = parseFrontmatter(raw);
      if (!fm) continue;

      // Projects use "state" instead of "status"
      const status = toStr(fm.status || fm.state);
      if (!status && !fm.id) continue; // Skip files with no meaningful frontmatter

      items.push({
        id: toStr(fm.id),
        type: toStr(fm.type),
        title: toStr(fm.title),
        status,
        priority: toNumber(fm.priority),
        estimate: toNumber(fm.estimate),
        summary: toStr(fm.summary),
        outcome: toStr(fm.outcome),
        assignees: toStringArray(fm.assignees),
        labels: toStringArray(fm.labels),
        created: toStr(fm.created),
        updated: toStr(fm.updated),
        branch: toStr(fm.branch),
        path: relPath,
        project: toStr(fm.project || fm.primary_charter),
      });
    }
  }

  return items;
}
