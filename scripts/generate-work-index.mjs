#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/generate-work-index`
 * Purpose: Generate work/items/_index.md from individual work item frontmatter.
 * Scope: Reads work/items and work/projects .md files, writes _index.md; does NOT modify individual item files.
 * Invariants: INDEX_IS_DERIVED — _index.md is never hand-edited.
 * Side-effects: IO (filesystem reads + one write)
 * Links: [Work README](../work/README.md)
 * @public
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";

const ROOT = process.cwd();
const OUT_PATH = "work/items/_index.md";

const TERMINAL_STATUSES = new Set(["done", "cancelled"]);

function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("missing YAML frontmatter");
  const props = parseYaml(match[1]);
  if (!props || typeof props !== "object")
    throw new Error("invalid YAML frontmatter");
  return props;
}

function norm(v) {
  if (v == null) return "";
  return String(v).trim();
}

function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function idNum(id) {
  const m = id.match(/\.(\d+)$/);
  return m ? Number(m[1]) : 0;
}

// Load project titles: proj.slug → human-readable title
function loadProjectTitles() {
  const map = new Map();
  const files = fg.sync(["work/projects/**/*.md"], { cwd: ROOT });
  for (const file of files) {
    try {
      const raw = readFileSync(file, "utf8");
      const fm = extractFrontmatter(raw);
      const id = norm(fm.id);
      const title = norm(fm.title);
      if (id && title) {
        // Strip the long suffix — use short name like the hand-edited index does
        // e.g. "Decentralized Identity — DID-First Members..." → "Decentralized Identity"
        const short = title.split("—")[0].split("–")[0].trim();
        map.set(id, short);
      }
    } catch {
      // skip unparseable project files
    }
  }
  return map;
}

function main() {
  const projectTitles = loadProjectTitles();

  const files = fg.sync(
    [
      "work/items/**/*.md",
      "!work/items/_index.md",
      "!work/items/_archive/**",
      "!work/items/_templates/**",
    ],
    { cwd: ROOT }
  );

  const items = [];
  const idMap = new Map(); // id → file path, for duplicate detection
  const errors = [];

  for (const file of files) {
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch (e) {
      errors.push(`${file}: cannot read — ${e.message}`);
      continue;
    }

    let fm;
    try {
      fm = extractFrontmatter(raw);
    } catch (e) {
      errors.push(`${file}: ${e.message}`);
      continue;
    }

    const id = norm(fm.id);
    if (!id) continue;

    // Duplicate ID check
    if (idMap.has(id)) {
      errors.push(
        `Duplicate ID "${id}" found in:\n  - ${idMap.get(id)}\n  - ${file}`
      );
    } else {
      idMap.set(id, file);
    }

    const status = norm(fm.status);
    const projectId = norm(fm.project);

    items.push({
      id,
      title: norm(fm.title),
      status,
      priority: asNum(fm.priority),
      rank: asNum(fm.rank),
      estimate: asNum(fm.estimate),
      projectId,
      projectTitle: projectId ? projectTitles.get(projectId) || "" : "",
    });
  }

  if (errors.length > 0) {
    console.error("work:index errors:");
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }

  // Partition
  const active = items.filter((i) => !TERMINAL_STATUSES.has(i.status));
  const done = items.filter((i) => TERMINAL_STATUSES.has(i.status));

  // Sort active: priority ASC → rank ASC → id ASC
  active.sort((a, b) => {
    const pa = a.priority ?? 99;
    const pb = b.priority ?? 99;
    if (pa !== pb) return pa - pb;
    const ra = a.rank ?? 99;
    const rb = b.rank ?? 99;
    if (ra !== rb) return ra - rb;
    return idNum(a.id) - idNum(b.id);
  });

  // Sort done: priority ASC → id ASC
  done.sort((a, b) => {
    const pa = a.priority ?? 99;
    const pb = b.priority ?? 99;
    if (pa !== pb) return pa - pb;
    return idNum(a.id) - idNum(b.id);
  });

  // Build output
  const lines = [];
  lines.push("<!-- GENERATED — do not edit. Run: pnpm work:index -->");
  lines.push("");
  lines.push("# Work Items Index");
  lines.push("");
  lines.push("> Generated from work item frontmatter. Do not hand-edit.");
  lines.push("");
  lines.push("## Active");
  lines.push("");
  lines.push(
    "| Pri | Rank | Est | Status | ID | Title | Project | Project ID |"
  );
  lines.push(
    "| --- | ---- | --- | ------ | -- | ----- | ------- | ---------- |"
  );

  for (const it of active) {
    const pri = it.priority != null ? String(it.priority) : "";
    const rank = it.rank != null ? String(it.rank) : "";
    const est = it.estimate != null ? String(it.estimate) : "";
    lines.push(
      `| ${pri} | ${rank} | ${est} | ${it.status} | ${it.id} | ${it.title} | ${it.projectTitle} | ${it.projectId} |`
    );
  }

  lines.push("");
  lines.push("> Sort: priority ASC → rank ASC");
  lines.push("");
  lines.push("## Done");
  lines.push("");
  lines.push("| Pri | ID | Title | Project | Project ID |");
  lines.push("| --- | -- | ----- | ------- | ---------- |");

  for (const it of done) {
    const pri = it.priority != null ? String(it.priority) : "";
    lines.push(
      `| ${pri} | ${it.id} | ${it.title} | ${it.projectTitle} | ${it.projectId} |`
    );
  }

  lines.push("");
  lines.push("> Sort: priority ASC → ID ASC");
  lines.push("");

  const output = lines.join("\n");
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, output, "utf8");

  const total = active.length + done.length;
  console.log(
    `work:index — ${active.length} active, ${done.length} done (${total} total)`
  );
}

main();
