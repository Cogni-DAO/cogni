// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `nodes/operator/app/scripts/import-work-items-via-api`
 * Purpose: HTTP-based v0 of the markdown → Doltgres importer (task.5002). POSTs each `work/items/*.md` row to the deployed `/api/v1/work/items` endpoint via fetch. IDs drift to the `5000+` range (server-allocated). Source-of-truth provenance is preserved in a sidecar `task5002-import-mapping-<env>-<sha8>.json` (legacyId, allocatedId, github blob URL with pinned HEAD sha) — NOT in the row itself, so summaries render cleanly. v1 will add proper `externalRefs` schema support; once it lands, bulk-PATCH will attach FK refs from the sidecar.
 * Scope: One-shot CLI + reusable `importWorkItems()` function for composition into other scripts/skills.
 * Invariants:
 *   - REPO_ROOT_DEFAULTS_TO_TOPLEVEL: `--repo-root` default resolves via `git rev-parse --show-toplevel`.
 *   - SUMMARY_PRISTINE: imported `summary` is the original markdown summary, untouched. No `legacy_id=` prefix, no `Source:` footer, no provenance noise — the row renders as humans wrote it.
 *   - PROVENANCE_IN_SIDECAR: every (legacyId → allocatedId) pair is captured with its github blob URL in a JSON sidecar at the repo root, named `task5002-import-mapping-<env>-<sha8>.json`. Forensics + future externalRefs back-fill use this file.
 *   - NO_DIRECT_DB: this script does NOT talk to Doltgres directly — only HTTPS to `--api`.
 * Side-effects: IO (reads markdown files, makes HTTPS POSTs).
 * Links: work/items/task.5002.md-to-doltgres-importer.md
 * @public
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { WorkItem } from "@cogni/work-items";
import { MarkdownWorkItemAdapter } from "@cogni/work-items/markdown";

interface CliArgs {
  readonly repoRoot: string;
  readonly api: string;
  readonly dryRun: boolean;
  readonly limit: number | null;
  readonly delayMs: number;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  let repoRoot: string | null = null;
  let api = "https://preview.cognidao.org";
  let dryRun = false;
  let limit: number | null = null;
  let delayMs = 50;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--repo-root") repoRoot = argv[++i] ?? null;
    else if (arg === "--api") api = argv[++i] ?? api;
    else if (arg === "--delay-ms") {
      delayMs = Number.parseInt(argv[++i] ?? "50", 10);
    } else if (arg === "--limit") {
      const next = argv[++i];
      const n = next ? Number.parseInt(next, 10) : Number.NaN;
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`--limit requires a positive integer, got: ${next}`);
      }
      limit = n;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!repoRoot) repoRoot = gitToplevel();
  return { repoRoot: resolve(repoRoot), api, dryRun, limit, delayMs };
}

function gitToplevel(): string {
  return execSync("git rev-parse --show-toplevel", {
    encoding: "utf8",
  }).trim();
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: tsx scripts/import-work-items-via-api.ts [options]",
      "",
      "  --repo-root <dir> Repo root (default: git rev-parse --show-toplevel)",
      "  --api <baseUrl>   API base (default: https://preview.cognidao.org)",
      "  --dry-run         Skip the POSTs; print what would be sent",
      "  --limit <N>       Process at most N items",
      "  --delay-ms <N>    Delay between POSTs (default: 50)",
      "",
      "Required env: COGNI_KEY  (Bearer token from /api/v1/agent/register)",
      "",
    ].join("\n")
  );
}

// ── Reusable importer (composable) ─────────────────────

export interface ImportOptions {
  readonly repoRoot: string;
  readonly api: string;
  readonly token: string;
  readonly dryRun?: boolean;
  readonly limit?: number | null;
  readonly delayMs?: number;
  readonly onProgress?: (info: {
    posted: number;
    failed: number;
    total: number;
  }) => void;
  readonly onLine?: (line: string) => void;
}

export interface ImportMappingEntry {
  readonly legacyId: string;
  readonly allocatedId: string;
  readonly sourceUrl: string | null;
}

export interface ImportResult {
  readonly posted: number;
  readonly failed: number;
  readonly total: number;
  readonly sourceSha: string;
  readonly mapping: ReadonlyArray<ImportMappingEntry>;
  readonly failures: ReadonlyArray<{
    id: string;
    status: number;
    error?: unknown;
  }>;
}

export async function importWorkItems(
  opts: ImportOptions
): Promise<ImportResult> {
  const log = opts.onLine ?? (() => {});
  const reader = new MarkdownWorkItemAdapter(opts.repoRoot);
  const { items: all } = await reader.list({});
  const VALID_TYPES = new Set(["task", "bug", "story", "spike", "subtask"]);
  const eligible = all.filter((it) => VALID_TYPES.has(it.type));
  const items: ReadonlyArray<WorkItem> = opts.limit
    ? eligible.slice(0, opts.limit)
    : eligible;
  log(
    `[importer] filtered ${all.length} → ${eligible.length} (skipped ${all.length - eligible.length} project rows)`
  );
  const ctx = loadSourceContext(opts.repoRoot);
  log(
    `[importer] read ${items.length} markdown items from ${opts.repoRoot} (sourceSha=${ctx.sha.slice(0, 8)})`
  );

  let posted = 0;
  let failed = 0;
  const mapping: Array<ImportMappingEntry> = [];
  const failures: Array<{ id: string; status: number; error?: unknown }> = [];
  const delay = opts.delayMs ?? 50;

  for (const item of items) {
    const body = buildBody(item);

    if (opts.dryRun) {
      log(`[dry] ${item.id} → ${JSON.stringify(body).slice(0, 120)}`);
      posted += 1;
      continue;
    }

    try {
      const { status, data } = await postOne(opts.api, opts.token, body);
      if (status >= 200 && status < 300) {
        const allocatedId = (data as { id?: string } | null)?.id ?? "(unknown)";
        mapping.push({
          legacyId: item.id as string,
          allocatedId,
          sourceUrl: sourceUrlFor(item, ctx),
        });
        posted += 1;

        // ── Hydrate fields the create endpoint doesn't accept ──
        const patchSet = buildPatchSet(item);
        if (patchSet && allocatedId !== "(unknown)") {
          const p = await patchOne(opts.api, opts.token, allocatedId, patchSet);
          if (p.status >= 400) {
            log(
              `[importer] PATCH-WARN ${item.id}→${allocatedId} status=${p.status} body=${JSON.stringify(p.data).slice(0, 200)}`
            );
          }
          if (delay > 0) await sleep(delay);
        }
      } else {
        failed += 1;
        failures.push({ id: item.id as string, status, error: data });
        log(
          `[importer] FAIL ${item.id} status=${status} body=${JSON.stringify(data).slice(0, 200)}`
        );
      }
    } catch (err) {
      failed += 1;
      failures.push({
        id: item.id as string,
        status: 0,
        error: err instanceof Error ? err.message : String(err),
      });
      log(
        `[importer] FAIL ${item.id} threw: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    opts.onProgress?.({ posted, failed, total: items.length });
    if (delay > 0) await sleep(delay);
  }

  return {
    posted,
    failed,
    total: items.length,
    sourceSha: ctx.sha,
    mapping,
    failures,
  };
}

const REPO_SLUG = "Cogni-DAO/node-template";

interface SourceContext {
  readonly sha: string;
  readonly filenameById: ReadonlyMap<string, string>;
}

function loadSourceContext(repoRoot: string): SourceContext {
  const sha = execSync("git rev-parse HEAD", {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();

  // ─ Build id → filename map by listing work/items/ ─
  // File convention: `<id>.<slug>.md` → take everything before the second dot.
  const itemsDir = `${repoRoot}/work/items`;
  const filenameById = new Map<string, string>();
  const files = execSync("ls", { cwd: itemsDir, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".md") && f !== "_index.md");
  for (const f of files) {
    // bug.0153.gh-app-pr-review-name-mismatch.md → "bug.0153"
    const parts = f.split(".");
    if (parts.length >= 3) {
      const id = `${parts[0]}.${parts[1]}`;
      filenameById.set(id, f);
    }
  }
  return { sha, filenameById };
}

function buildBody(item: WorkItem): Record<string, unknown> {
  const summary = (item.summary ?? "").trim();
  const body: Record<string, unknown> = {
    type: item.type,
    title: item.title,
  };
  if (summary) body.summary = summary;
  if (item.outcome) body.outcome = item.outcome;
  if (item.node && item.node !== "shared") body.node = item.node;
  if (item.projectId) body.projectId = item.projectId;
  if (item.parentId) body.parentId = item.parentId;
  if (item.specRefs?.length) body.specRefs = item.specRefs;
  if (item.labels?.length) body.labels = item.labels;
  return body;
}

function sourceUrlFor(item: WorkItem, ctx: SourceContext): string | null {
  const filename = ctx.filenameById.get(item.id as string);
  if (!filename) return null;
  return `https://github.com/${REPO_SLUG}/blob/${ctx.sha}/work/items/${filename}`;
}

async function postOne(
  apiBase: string,
  token: string,
  body: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${apiBase}/api/v1/work/items`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-json body; leave data null */
  }
  return { status: res.status, data };
}

function buildPatchSet(item: WorkItem): Record<string, unknown> | null {
  const set: Record<string, unknown> = {};
  if (item.status && item.status !== "needs_triage") set.status = item.status;
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
  apiBase: string,
  token: string,
  id: string,
  set: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${apiBase}/api/v1/work/items/${id}`, {
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
    /* leave null */
  }
  return { status: res.status, data };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  // biome-ignore lint/style/noProcessEnv: one-shot CLI — env-var auth
  const token = process.env.COGNI_KEY;
  if (!token || token.trim() === "") {
    throw new Error(
      "COGNI_KEY env var must be set (apiKey from /api/v1/agent/register)"
    );
  }

  process.stdout.write(
    `[importer] repoRoot=${args.repoRoot} api=${args.api} dryRun=${args.dryRun}${args.limit ? ` limit=${args.limit}` : ""}\n`
  );

  const result = await importWorkItems({
    repoRoot: args.repoRoot,
    api: args.api,
    token,
    dryRun: args.dryRun,
    limit: args.limit,
    delayMs: args.delayMs,
    onLine: (line) => process.stdout.write(`${line}\n`),
    onProgress: ({ posted, total }) => {
      if (posted > 0 && posted % 25 === 0) {
        process.stdout.write(`[importer] progress ${posted}/${total}\n`);
      }
    },
  });

  process.stdout.write(
    `[importer] done. posted=${result.posted} failed=${result.failed} of ${result.total}\n`
  );

  if (result.mapping.length > 0 && !args.dryRun) {
    const env = new URL(args.api).hostname.split(".")[0];
    const mappingPath = resolve(
      args.repoRoot,
      `task5002-import-mapping-${env}-${result.sourceSha.slice(0, 8)}.json`
    );
    writeFileSync(
      mappingPath,
      `${JSON.stringify(
        {
          api: args.api,
          sourceSha: result.sourceSha,
          posted: result.posted,
          failed: result.failed,
          total: result.total,
          mapping: result.mapping,
          failures: result.failures,
        },
        null,
        2
      )}\n`
    );
    process.stdout.write(`[importer] mapping written to ${mappingPath}\n`);

    const sample = result.mapping.slice(0, 5);
    process.stdout.write(
      `[importer] sample mapping (legacy → allocated):\n${sample.map((m) => `  ${m.legacyId} → ${m.allocatedId}`).join("\n")}\n`
    );
  }

  return result.failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `[importer] FATAL: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(2);
  });
