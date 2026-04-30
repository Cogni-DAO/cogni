// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `nodes/operator/app/scripts/patch-from-sidecar`
 * Purpose: Hydrates the fields the `POST /api/v1/work/items` endpoint cannot accept (status, priority, rank, estimate, branch, pr, reviewer) by reading the legacy → allocated mapping from a task5002-import-mapping-*.json sidecar and PATCHing each allocatedId with the source markdown's values.
 * Scope: One-shot CLI. Composes the existing `MarkdownWorkItemAdapter` + the API PATCH endpoint.
 * Side-effects: IO (reads markdown + sidecar; makes HTTPS PATCHes).
 * Links: work/items/task.5002.md-to-doltgres-importer.md
 * @public
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { WorkItem } from "@cogni/work-items";
import { MarkdownWorkItemAdapter } from "@cogni/work-items/markdown";

interface SidecarMapping {
  readonly legacyId: string;
  readonly allocatedId: string;
}

interface Sidecar {
  readonly api: string;
  readonly mapping: ReadonlyArray<SidecarMapping>;
}

const API_STATUSES = new Set([
  "needs_triage",
  "needs_research",
  "needs_design",
  "needs_implement",
  "needs_closeout",
  "needs_merge",
  "done",
  "blocked",
  "cancelled",
]);

const STATUS_ALIASES: Record<string, string> = {
  needs_review: "needs_merge",
};

function normalizeStatus(s: string): string | null {
  if (API_STATUSES.has(s)) return s;
  return STATUS_ALIASES[s] ?? null;
}

function buildPatchSet(item: WorkItem): Record<string, unknown> | null {
  const set: Record<string, unknown> = {};
  if (item.status) {
    const mapped = normalizeStatus(item.status);
    if (mapped && mapped !== "needs_triage") set.status = mapped;
  }
  if (item.priority !== undefined && item.priority !== null) {
    set.priority = item.priority;
  }
  if (item.rank !== undefined && item.rank !== null) set.rank = item.rank;
  if (item.estimate !== undefined && item.estimate !== null) {
    set.estimate = item.estimate;
  }
  if (item.branch) set.branch = item.branch;
  if (item.pr) set.pr = item.pr;
  if (item.reviewer) set.reviewer = item.reviewer;
  return Object.keys(set).length > 0 ? set : null;
}

async function patchOne(
  api: string,
  token: string,
  id: string,
  set: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${api}/api/v1/work/items/${id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ set }),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* */
  }
  return { status: res.status, data };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

async function main(): Promise<number> {
  const sidecarPath = process.argv[2];
  if (!sidecarPath) {
    process.stderr.write(
      "Usage: tsx scripts/patch-from-sidecar.ts <sidecar.json>\n  env: COGNI_KEY\n"
    );
    return 2;
  }

  // biome-ignore lint/style/noProcessEnv: one-shot CLI
  const token = process.env.COGNI_KEY;
  if (!token) throw new Error("COGNI_KEY env var must be set");

  const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as Sidecar;
  const repoRoot = execSync("git rev-parse --show-toplevel", {
    encoding: "utf8",
  }).trim();
  const reader = new MarkdownWorkItemAdapter(repoRoot);
  const { items } = await reader.list({});
  const byId = new Map<string, WorkItem>(items.map((i) => [i.id as string, i]));

  process.stdout.write(
    `[patch] sidecar=${resolve(sidecarPath)} api=${sidecar.api} mappings=${sidecar.mapping.length}\n`
  );

  let patched = 0;
  let skipped = 0;
  let failed = 0;
  for (const m of sidecar.mapping) {
    const item = byId.get(m.legacyId);
    if (!item) {
      skipped += 1;
      continue;
    }
    const set = buildPatchSet(item);
    if (!set) {
      skipped += 1;
      continue;
    }
    const r = await patchOne(sidecar.api, token, m.allocatedId, set);
    if (r.status >= 400) {
      failed += 1;
      process.stdout.write(
        `[patch] FAIL ${m.legacyId}→${m.allocatedId} status=${r.status} body=${JSON.stringify(r.data).slice(0, 200)}\n`
      );
    } else {
      patched += 1;
      if (patched % 25 === 0) {
        process.stdout.write(
          `[patch] progress patched=${patched} skipped=${skipped} failed=${failed}\n`
        );
      }
    }
    await sleep(30);
  }

  process.stdout.write(
    `[patch] done. patched=${patched} skipped=${skipped} failed=${failed} of ${sidecar.mapping.length}\n`
  );
  return failed > 0 ? 1 : 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    process.stderr.write(
      `[patch] FATAL: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(2);
  });
