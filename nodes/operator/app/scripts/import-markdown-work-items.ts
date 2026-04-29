// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `nodes/operator/app/scripts/import-markdown-work-items`
 * Purpose: One-shot CLI that reads every `work/items/*.md` and bulk-inserts the rows into `knowledge_operator.work_items` via DoltgresOperatorWorkItemAdapter.bulkInsert. Idempotent. Run thrice locally with port-forward — once per env (candidate-a → preview → prod).
 * Scope: CLI entrypoint. Wires MarkdownWorkItemAdapter (read) → DoltgresOperatorWorkItemAdapter (write). Reads `DOLTGRES_URL` + `IMPORTER_AUTHOR` from env.
 * Invariants:
 *   - PATH_ANCHORED_TO_REPO_ROOT: `--root` default resolves via `git rev-parse --show-toplevel`. Aborts if the path has zero `.md` files.
 *   - AUTHOR_REQUIRED: `IMPORTER_AUTHOR` env var must be set; aborts otherwise.
 *   - SINGLE_COMMIT_PER_RUN: bulkInsert issues exactly one dolt_commit (skipped when inserted=0).
 *   - IDEMPOTENT: re-runs against an unchanged corpus produce 0 inserted, 0 commits.
 * Side-effects: IO (reads markdown files, writes Doltgres rows + dolt_commit, prints summary to stdout).
 * Links: work/items/task.5002.md-to-doltgres-importer.md
 * @public
 */

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { buildDoltgresClient } from "@cogni/knowledge-store/adapters/doltgres";
import type { WorkItem } from "@cogni/work-items";
import { MarkdownWorkItemAdapter } from "@cogni/work-items/markdown";

import { DoltgresOperatorWorkItemAdapter } from "../src/adapters/server/db/doltgres/work-items-adapter";

interface CliArgs {
  readonly root: string;
  readonly dryRun: boolean;
  readonly limit: number | null;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  let root: string | null = null;
  let dryRun = false;
  let limit: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--root") {
      root = argv[++i] ?? null;
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

  if (!root) {
    root = `${resolveRepoToplevel()}/work/items`;
  }

  return { root: resolve(root), dryRun, limit };
}

function resolveRepoToplevel(): string {
  const out = execSync("git rev-parse --show-toplevel", { encoding: "utf8" });
  return out.trim();
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: tsx scripts/import-markdown-work-items.ts [options]",
      "",
      "  --root <dir>   Path to work items dir (default: <repo-root>/work/items)",
      "  --dry-run      Report counts without writing to Doltgres",
      "  --limit <N>    Process at most N items (for smoke testing)",
      "",
      "Required env:",
      "  DOLTGRES_URL       Postgres-wire URL of the target operator Doltgres",
      "  IMPORTER_AUTHOR    Author tag for dolt_log (e.g. user:derekg1729)",
      "",
    ].join("\n")
  );
}

function assertHasMdFiles(root: string): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (err) {
    throw new Error(
      `Cannot read --root '${root}': ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const mdCount = entries.filter(
    (e) => e.endsWith(".md") && e !== "_index.md"
  ).length;
  if (mdCount === 0) {
    throw new Error(`No .md files found in --root '${root}'`);
  }
}

async function captureHead(
  client: ReturnType<typeof buildDoltgresClient>
): Promise<string | null> {
  try {
    const rows = await client.unsafe("SELECT dolt_hashof('HEAD') AS sha");
    const sha = (rows as ReadonlyArray<Record<string, unknown>>)[0]?.sha;
    return sha ? String(sha) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  // biome-ignore lint/style/noProcessEnv: one-shot CLI invoked locally — env-var auth is the single source of credentials, no centralized config exists for this script
  const author = process.env.IMPORTER_AUTHOR;
  if (!author || author.trim() === "") {
    throw new Error(
      "IMPORTER_AUTHOR env var must be set (e.g. IMPORTER_AUTHOR=user:derekg1729)"
    );
  }

  // biome-ignore lint/style/noProcessEnv: one-shot CLI invoked locally — same rationale as IMPORTER_AUTHOR above
  const doltgresUrl = process.env.DOLTGRES_URL;
  if (!doltgresUrl || doltgresUrl.trim() === "") {
    throw new Error("DOLTGRES_URL env var must be set");
  }

  assertHasMdFiles(args.root);

  process.stdout.write(
    `[importer] root=${args.root} author=${author} dryRun=${args.dryRun}${args.limit ? ` limit=${args.limit}` : ""}\n`
  );

  const reader = new MarkdownWorkItemAdapter(args.root);
  const { items: allItems } = await reader.list({});
  const items: ReadonlyArray<WorkItem> = args.limit
    ? allItems.slice(0, args.limit)
    : allItems;

  process.stdout.write(`[importer] read ${items.length} markdown items\n`);

  if (args.dryRun) {
    process.stdout.write(
      `[importer] DRY RUN — would attempt bulkInsert of ${items.length} items\n`
    );
    return 0;
  }

  const client = buildDoltgresClient({
    connectionString: doltgresUrl,
    applicationName: "cogni_work_items_importer",
  });

  try {
    const preHead = await captureHead(client);
    process.stdout.write(
      `[importer] pre-import HEAD=${preHead ?? "unknown"}\n`
    );

    const adapter = new DoltgresOperatorWorkItemAdapter(client);
    const result = await adapter.bulkInsert(items, author);

    process.stdout.write(
      `[importer] result inserted=${result.inserted} skipped=${result.skipped} failed=${result.failed} doltCommit=${result.doltCommitHash ?? "(none — empty diff)"}\n`
    );

    if (result.failures.length > 0) {
      process.stdout.write(`[importer] failures:\n`);
      for (const f of result.failures) {
        process.stdout.write(`  - ${f.id}: ${f.error}\n`);
      }
    }

    process.stdout.write(
      `[importer] done. To rollback: psql "$DOLTGRES_URL" -c "CALL dolt_reset('--hard', '${preHead ?? "<sha>"}')"\n`
    );

    return result.failed > 0 ? 1 : 0;
  } finally {
    await client.end({ timeout: 5 });
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `[importer] FATAL: ${err instanceof Error ? err.message : String(err)}\n`
    );
    if (err instanceof Error && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exit(2);
  });
