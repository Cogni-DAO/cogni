// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/contributor-cli`
 * Purpose: CLI entry point for AI agents contributing to Cogni repos.
 * Scope: Parses CLI args, dispatches to task/claim/status commands. Does not own business logic.
 * Invariants: All output via console. Exit codes: 0=success, 1=error.
 * Side-effects: IO (console, file reads/writes, shell exec via gh)
 * Links: docs/research/agent-contributor-protocol.md
 * @public
 */

import { getCurrentBranch, getPrStatus, isGhAuthenticated } from "./git.js";
import {
  findWorkItemsDir,
  listActionableItems,
  readWorkItem,
  updateWorkItem,
} from "./work-items.js";

const HELP = `
cogni-contribute — AI agent contribution CLI for Cogni repos

COMMANDS:
  help                                     Show this help
  tasks [--status <s>] [--node <slug>]     List work items (filter by status/node)
  claim <task_id>                          Claim a task (sets assignee + branch in frontmatter)
  status [task_id]                         Check work item + PR + CI status
  unclaim <task_id>                        Release a claimed task

WORKFLOW:
  1. cogni-contribute tasks --node poly        # find work for your node
  2. cogni-contribute claim task.0264          # claim the task
  3. git checkout -b feat/task.0264-slug origin/canary
  4. <implement, run pnpm check:fast>
  5. git push -u origin feat/task.0264-slug
  6. gh pr create --base canary
  7. cogni-contribute status task.0264          # track CI + review
`.trim();

function printTable(
  headers: string[],
  rows: string[][],
  widths: number[]
): void {
  const header = headers.map((h, i) => h.padEnd(widths[i] ?? 20)).join("  ");
  console.log(header);
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    console.log(row.map((c, i) => c.padEnd(widths[i] ?? 20)).join("  "));
  }
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

/** Match a node slug against a work item's project or labels. */
function matchesNode(
  item: { project: string; labels: string[] },
  node: string
): boolean {
  const slug = node.toLowerCase();
  // project field: "proj.poly-prediction-bot" matches --node poly
  if (item.project.toLowerCase().includes(slug)) return true;
  // labels: ["nodes", "poly"] matches --node poly
  if (item.labels.some((l) => l.toLowerCase() === slug)) return true;
  // operator is the default node — match items with no node-specific project
  if (slug === "operator" && !item.project) return true;
  return false;
}

async function cmdTasks(args: string[]): Promise<void> {
  const statusFilter = parseFlag(args, "--status");
  const nodeFilter = parseFlag(args, "--node");

  const itemsDir = findWorkItemsDir();
  let items = listActionableItems(itemsDir);

  if (statusFilter) {
    items = items.filter((i) => i.status === statusFilter);
  }

  if (nodeFilter) {
    items = items.filter((i) => matchesNode(i, nodeFilter));
  }

  if (items.length === 0) {
    console.log("No actionable work items found.");
    return;
  }

  printTable(
    ["PRI", "STATUS", "ID", "TITLE"],
    items.map((i) => [String(i.priority), i.status, i.id, i.title]),
    [4, 18, 20, 50]
  );
}

async function cmdClaim(args: string[]): Promise<void> {
  const taskId = args[0];
  if (!taskId) {
    console.error("Usage: cogni-contribute claim <task_id>");
    process.exit(1);
  }

  const itemsDir = findWorkItemsDir();
  const item = readWorkItem(itemsDir, taskId);
  if (!item) {
    console.error(`Work item not found: ${taskId}`);
    process.exit(1);
  }

  const { fm, file } = item;
  const status = String(fm.status ?? "");
  if (!["needs_implement", "needs_research", "needs_design"].includes(status)) {
    console.error(`${taskId} has status '${status}' — not claimable`);
    process.exit(1);
  }

  const currentAssignee = String(fm.assignees ?? "");
  if (currentAssignee && currentAssignee !== "null") {
    console.error(`${taskId} already assigned to: ${currentAssignee}`);
    process.exit(1);
  }

  // Suggest branch name
  const slug = String(fm.title ?? "work")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 30);
  const branch = `feat/${taskId}-${slug}`;

  // Update work item frontmatter only — agent handles git
  updateWorkItem(itemsDir, file, {
    branch,
    assignees: `agent:${process.env.USER ?? "contributor"}`,
  });

  console.log(`CLAIMED: ${taskId}`);
  console.log(`Suggested branch: ${branch}`);
  console.log(`\nNext steps (you handle git):`);
  console.log(`  git checkout -b ${branch} origin/canary`);
  console.log(`  <implement the task>`);
  console.log(`  pnpm check:fast`);
  console.log(`  git push -u origin ${branch}`);
  console.log(`  gh pr create --base canary`);
}

async function cmdUnclaim(args: string[]): Promise<void> {
  const taskId = args[0];
  if (!taskId) {
    console.error("Usage: cogni-contribute unclaim <task_id>");
    process.exit(1);
  }

  const itemsDir = findWorkItemsDir();
  const item = readWorkItem(itemsDir, taskId);
  if (!item) {
    console.error(`Work item not found: ${taskId}`);
    process.exit(1);
  }

  updateWorkItem(itemsDir, item.file, {
    assignees: "",
    branch: "",
  });

  console.log(`UNCLAIMED: ${taskId}`);
}

async function cmdStatus(args: string[]): Promise<void> {
  const itemsDir = findWorkItemsDir();

  let taskId = args[0];
  if (!taskId) {
    // Try to infer from current branch
    const branch = getCurrentBranch();
    const match = branch.match(/(task|bug|spike)\.\d{4}/);
    taskId = match?.[0] ?? undefined;
  }

  if (!taskId) {
    console.error(
      "Cannot determine task ID. Pass it as argument or work on a task branch."
    );
    process.exit(1);
  }

  const item = readWorkItem(itemsDir, taskId);
  if (!item) {
    console.error(`Work item not found: ${taskId}`);
    process.exit(1);
  }

  const { fm } = item;
  console.log(`=== ${taskId} ===`);
  console.log(`  status:    ${fm.status}`);
  console.log(`  assignees: ${fm.assignees ?? "(none)"}`);
  console.log(`  branch:    ${fm.branch ?? "(none)"}`);
  console.log(`  pr:        ${fm.pr ?? "(none)"}`);
  console.log(`  revision:  ${fm.revision ?? 0}`);

  const pr = String(fm.pr ?? "");
  if (pr && pr !== "null" && pr.startsWith("http")) {
    try {
      const prStatus = getPrStatus(pr);
      console.log(`  pr_state:  ${prStatus.state}`);
      console.log(`  ci_pass:   ${prStatus.checksPass}`);
      console.log(`  review:    ${prStatus.reviewDecision || "(pending)"}`);
    } catch {
      console.log(`  pr_state:  (could not fetch)`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2);

if (!command || command === "help" || command === "--help") {
  console.log(HELP);
  process.exit(0);
}

if (!isGhAuthenticated()) {
  console.error("ERROR: gh CLI not authenticated. Run 'gh auth login' first.");
  process.exit(1);
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  tasks: cmdTasks,
  claim: cmdClaim,
  unclaim: cmdUnclaim,
  status: cmdStatus,
};

const handler = commands[command];
if (!handler) {
  console.error(`Unknown command: ${command}\n`);
  console.log(HELP);
  process.exit(1);
}

handler(args).catch((err: Error) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
