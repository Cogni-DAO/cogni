#!/usr/bin/env npx tsx
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO
/**
 * Module: `@scripts/setup-secrets`
 * Purpose: Interactive secret provisioning for Cogni node formation.
 * Scope: Walks through all GitHub Actions secrets (preview + production), auto-generates agent-rotatable values, prompts for human-provided ones with dashboard URLs; does not modify code or deploy.
 * Invariants: Secrets set per-env only. Agent secrets use openssl rand.
 * Side-effects: IO (sets GitHub Actions secrets via gh secret set)
 * Links: docs/runbooks/SECRET_ROTATION.md
 *
 * Usage:
 *   pnpm setup:secrets                        # walk through missing secrets (all envs)
 *   pnpm setup:secrets --env canary           # only canary environment
 *   pnpm setup:secrets --env canary --all     # canary, including already-set
 *   pnpm setup:secrets --required             # only required secrets
 *   pnpm setup:secrets --all                  # walk through everything (including already-set)
 *   pnpm setup:secrets --only DISCORD         # just secrets matching "DISCORD"
 *   pnpm setup:secrets --only DISCORD,SONAR   # multiple patterns (comma-separated)
 */

import { execSync } from "node:child_process";
import * as readline from "node:readline";

// ── Types ────────────────────────────────────────────────────────────────────

interface Secret {
  name: string;
  required: boolean;
  category: string;
  description: string;
  /** "agent" = we generate it, "human" = paste from dashboard */
  source: "agent" | "human";
  /** URL to visit (human secrets) */
  url?: string;
  /** Step-by-step instructions (rendered as vertical list) */
  steps: string[];
  /** Generator function for agent secrets */
  generate?: () => string;
  /** true if preview and production typically have DIFFERENT values */
  perEnv?: boolean;
  /** true if this is a repo-level secret (CI), not per-environment (deploy) */
  repoLevel?: boolean;
  /** Optional value transform before setting (e.g. append URL path) */
  transform?: (value: string) => string;
}

// ── Generators ───────────────────────────────────────────────────────────────

function rand64(bytes = 32): string {
  return execSync(`openssl rand -base64 ${bytes}`).toString().trim();
}

function randHex(bytes = 32): string {
  return execSync(`openssl rand -hex ${bytes}`).toString().trim();
}

function generateSSHKey(env: string): string {
  const path = `/tmp/cogni-deploy-key-${env}-${Date.now()}`;
  execSync(
    `ssh-keygen -t ed25519 -f ${path} -N "" -C "cogni-deploy-${env}-$(date +%Y%m%d)" -q`
  );
  const privKey = execSync(`cat ${path}`).toString();
  const pubKey = execSync(`cat ${path}.pub`).toString().trim();
  execSync(`rm -f ${path} ${path}.pub`);
  console.log("");
  console.log(`     Public key for ${env}:`);
  console.log(`     ${pubKey}`);
  console.log("");
  console.log(
    `     Save this to: infra/provision/cherry/base/keys/cogni_template_${env}_deploy.pub`
  );
  console.log(`     Then run: tofu apply -var-file=terraform.${env}.tfvars`);
  console.log("");
  return privKey;
}

// ── Secret Catalog ───────────────────────────────────────────────────────────

const SECRETS: Secret[] = [
  // ── Required: Agent-generated ──────────────────────────────────────────
  {
    name: "AUTH_SECRET",
    required: true,
    category: "Core App",
    source: "agent",
    description: "NextAuth session encryption key",
    steps: ["Auto-generated random string"],
    generate: () => rand64(32),
  },
  {
    name: "LITELLM_MASTER_KEY",
    required: true,
    category: "Core App",
    source: "agent",
    description: "LiteLLM proxy master API key",
    steps: ["Auto-generated sk-cogni-* key"],
    generate: () => `sk-cogni-${randHex(24)}`,
  },
  {
    name: "OPENCLAW_GATEWAY_TOKEN",
    required: true,
    category: "Core App",
    source: "agent",
    description: "OpenClaw gateway WS auth token",
    steps: ["Auto-generated random string"],
    generate: () => rand64(32),
  },
  {
    name: "SCHEDULER_API_TOKEN",
    required: true,
    category: "Internal Service",
    source: "agent",
    description: "scheduler-worker -> internal graph API auth",
    steps: ["Auto-generated random string"],
    generate: () => rand64(32),
  },
  {
    name: "BILLING_INGEST_TOKEN",
    required: true,
    category: "Internal Service",
    source: "agent",
    description: "LiteLLM callback -> billing ingest endpoint auth",
    steps: ["Auto-generated random string"],
    generate: () => rand64(32),
  },
  {
    name: "INTERNAL_OPS_TOKEN",
    required: true,
    category: "Internal Service",
    source: "agent",
    description: "Deploy trigger -> governance schedule sync auth",
    steps: ["Auto-generated random string"],
    generate: () => rand64(32),
  },
  {
    name: "METRICS_TOKEN",
    required: true,
    category: "Internal Service",
    source: "agent",
    description: "Prometheus scrape -> /api/metrics auth",
    steps: ["Auto-generated random string"],
    generate: () => rand64(32),
  },
  {
    name: "GH_WEBHOOK_SECRET",
    required: true,
    category: "Internal Service",
    source: "agent",
    description: "GitHub webhook HMAC verification secret",
    steps: ["Auto-generated hex string"],
    generate: () => randHex(32),
  },
  {
    name: "SSH_DEPLOY_KEY",
    required: true,
    category: "Infrastructure",
    source: "agent",
    description: "SSH private key for deploy to server",
    perEnv: true,
    steps: [
      "Auto-generated ed25519 keypair (one per environment)",
      "1. Pubkey pushed to server via existing SSH access",
      "2. Private key set in GitHub environment secret",
      "3. Pubkey saved to infra/provision/cherry/base/keys/",
      "4. Run: tofu apply -var-file=terraform.<env>.tfvars",
    ],
    // generate handled specially in main loop
  },

  // ── Infrastructure: repo-level ──────────────────────────────────────────
  {
    name: "CHERRY_AUTH_TOKEN",
    required: true,
    category: "Infrastructure",
    source: "human",
    repoLevel: true,
    description: "Cherry Servers API token for VM provisioning (tofu apply)",
    url: "https://portal.cherryservers.com/settings/api-keys",
    steps: [
      "API Keys page",
      "Create or copy existing API key",
      "Also export locally: export CHERRY_AUTH_TOKEN=<value>",
    ],
  },

  // ── Required: Human-provided ───────────────────────────────────────────
  {
    name: "OPENROUTER_API_KEY",
    required: true,
    category: "Core App",
    source: "human",
    description: "OpenRouter LLM API key",
    url: "https://openrouter.ai/keys",
    steps: ["Create a new API key", "Copy the full key (starts with sk-)"],
  },
  {
    name: "EVM_RPC_URL",
    required: true,
    category: "Core App",
    source: "human",
    description: "Base mainnet RPC endpoint for on-chain verification",
    url: "https://dashboard.alchemy.com/",
    steps: [
      "Create a new app (chain: Base mainnet)",
      "Copy the full HTTPS URL including API key",
    ],
  },
  {
    name: "OPENCLAW_GITHUB_RW_TOKEN",
    required: true,
    category: "Core App",
    source: "human",
    description: "GitHub PAT for OpenClaw git relay (push + PR)",
    url: "https://github.com/settings/tokens?type=beta",
    steps: [
      "Create fine-grained personal access token",
      "Resource owner: Cogni-DAO",
      "Repository access: All repositories (or select repos)",
      "Permissions:",
      "  - Contents: Read and write",
      "  - Pull requests: Read and write",
    ],
  },
  {
    name: "POSTHOG_API_KEY",
    required: true,
    category: "Core App",
    source: "human",
    description: "PostHog project API key",
    url: "https://us.posthog.com/settings/project#variables",
    steps: ["Copy the Project API Key from project settings"],
  },
  {
    name: "POSTHOG_HOST",
    required: true,
    category: "Core App",
    source: "human",
    description: "PostHog instance URL",
    url: "https://us.posthog.com/settings/project#variables",
    steps: ['e.g. "https://us.i.posthog.com" for US Cloud'],
  },
  {
    name: "GHCR_DEPLOY_TOKEN",
    required: true,
    category: "Infrastructure",
    source: "human",
    repoLevel: true,
    description: "GitHub PAT for docker pull from GHCR on deploy server",
    url: "https://github.com/settings/tokens?type=beta",
    steps: [
      "Create fine-grained personal access token",
      "Resource owner: Cogni-DAO",
      "Permissions:",
      "  - Packages: Read",
    ],
  },
  {
    name: "DOMAIN",
    required: true,
    category: "Infrastructure",
    source: "human",
    description: "Server domain name",
    perEnv: true,
    steps: ['e.g. "preview.cogni.dev" / "app.cogni.dev"'],
  },
  {
    name: "VM_HOST",
    required: true,
    category: "Infrastructure",
    source: "human",
    description: "Deploy target IP or hostname",
    perEnv: true,
    steps: ["The IP address of your Cherry Server VM"],
  },

  // ── Required: Database (grouped) ───────────────────────────────────────
  {
    name: "POSTGRES_ROOT_USER",
    required: true,
    category: "Database",
    source: "agent",
    description: "Postgres superuser name",
    steps: ['Convention: "postgres"'],
    generate: () => "postgres",
  },
  {
    name: "POSTGRES_ROOT_PASSWORD",
    required: true,
    category: "Database",
    source: "agent",
    description: "Postgres superuser password",
    steps: ["Auto-generated hex string (URL-safe for DSN construction)"],
    generate: () => randHex(24),
  },
  {
    name: "APP_DB_NAME",
    required: true,
    category: "Database",
    source: "agent",
    description: "Application database name",
    steps: ['Convention: "cogni_template"'],
    generate: () => "cogni_template",
  },
  {
    name: "APP_DB_USER",
    required: true,
    category: "Database",
    source: "agent",
    description: "App user (RLS enforced)",
    steps: ['Convention: "app_user"'],
    generate: () => "app_user",
  },
  {
    name: "APP_DB_PASSWORD",
    required: true,
    category: "Database",
    source: "agent",
    description: "App user password",
    steps: ["Auto-generated hex string (URL-safe for DSN construction)"],
    generate: () => randHex(24),
  },
  {
    name: "APP_DB_SERVICE_USER",
    required: true,
    category: "Database",
    source: "agent",
    description: "Service user (BYPASSRLS)",
    steps: ['Convention: "app_service"'],
    generate: () => "app_service",
  },
  {
    name: "APP_DB_SERVICE_PASSWORD",
    required: true,
    category: "Database",
    source: "agent",
    description: "Service user password",
    steps: ["Auto-generated hex string (URL-safe for DSN construction)"],
    generate: () => randHex(24),
  },
  {
    name: "TEMPORAL_DB_USER",
    required: true,
    category: "Database",
    source: "agent",
    description: "Temporal database user",
    steps: ['Convention: "temporal"'],
    generate: () => "temporal",
  },
  {
    name: "TEMPORAL_DB_PASSWORD",
    required: true,
    category: "Database",
    source: "agent",
    description: "Temporal database password",
    steps: ["Auto-generated hex string (URL-safe for DSN construction)"],
    generate: () => randHex(24),
  },

  // ── CI / Automation ────────────────────────────────────────────────────
  {
    name: "ACTIONS_AUTOMATION_BOT_PAT",
    required: false,
    category: "CI / Automation",
    source: "human",
    repoLevel: true,
    description: "GitHub PAT for cross-repo workflow dispatch and release PRs",
    url: "https://github.com/settings/tokens?type=beta",
    steps: [
      "Create fine-grained personal access token",
      "Permissions:",
      "  - Actions: Read and write",
      "  - Contents: Read and write",
      "  - Pull requests: Read and write",
    ],
  },
  {
    name: "GIT_READ_TOKEN",
    required: false,
    category: "CI / Automation",
    source: "human",
    repoLevel: true,
    description: "GitHub PAT for git-sync container (repo clone)",
    url: "https://github.com/settings/tokens?type=beta",
    steps: [
      "Create fine-grained personal access token",
      "Permissions:",
      "  - Contents: Read-only",
      "(Public repos work without token)",
    ],
  },
  {
    name: "SONAR_TOKEN",
    required: false,
    category: "CI / Automation",
    source: "human",
    repoLevel: true,
    description: "SonarCloud analysis token",
    url: "https://sonarcloud.io/account/security",
    steps: ["Generate a new token", "Copy the full value"],
  },

  // ── Optional: GitHub App (PR Review Bot) ───────────────────────────────
  {
    name: "GH_REVIEW_APP_ID",
    required: false,
    category: "GitHub App (PR Review)",
    source: "human",
    description: "GitHub App numeric ID",
    url: "https://github.com/settings/apps",
    steps: ["Your GitHub App", "General tab", "Copy App ID"],
  },
  {
    name: "GH_REVIEW_APP_PRIVATE_KEY_BASE64",
    required: false,
    category: "GitHub App (PR Review)",
    source: "human",
    description: "GitHub App private key (base64-encoded PEM)",
    url: "https://github.com/settings/apps",
    steps: [
      "Your GitHub App",
      "General tab -> Generate a private key",
      "Then run: base64 -w0 < downloaded-key.pem",
      "Paste the base64 output",
    ],
  },

  // ── Optional: OAuth Providers ──────────────────────────────────────────
  {
    name: "GH_OAUTH_CLIENT_ID",
    required: false,
    category: "OAuth (GitHub)",
    source: "human",
    description: "GitHub OAuth App client ID",
    url: "https://github.com/settings/developers",
    steps: ["OAuth Apps", "Your app", "Copy Client ID"],
  },
  {
    name: "GH_OAUTH_CLIENT_SECRET",
    required: false,
    category: "OAuth (GitHub)",
    source: "human",
    description: "GitHub OAuth App client secret",
    url: "https://github.com/settings/developers",
    steps: ["OAuth Apps", "Your app", "Generate a new client secret"],
  },
  {
    name: "DISCORD_OAUTH_CLIENT_ID",
    required: false,
    category: "OAuth (Discord)",
    source: "human",
    description: "Discord OAuth2 client ID",
    url: "https://discord.com/developers/applications",
    steps: ["Your app", "OAuth2 tab", "Copy Client ID"],
  },
  {
    name: "DISCORD_OAUTH_CLIENT_SECRET",
    required: false,
    category: "OAuth (Discord)",
    source: "human",
    description: "Discord OAuth2 client secret",
    url: "https://discord.com/developers/applications",
    steps: ["Your app", "OAuth2 tab", "Reset Secret"],
  },
  {
    name: "GOOGLE_OAUTH_CLIENT_ID",
    required: false,
    category: "OAuth (Google)",
    source: "human",
    description: "Google OAuth client ID",
    url: "https://console.cloud.google.com/apis/credentials",
    steps: ["OAuth 2.0 Client IDs", "Your client", "Copy Client ID"],
  },
  {
    name: "GOOGLE_OAUTH_CLIENT_SECRET",
    required: false,
    category: "OAuth (Google)",
    source: "human",
    description: "Google OAuth client secret",
    url: "https://console.cloud.google.com/apis/credentials",
    steps: ["OAuth 2.0 Client IDs", "Your client", "Copy Client secret"],
  },

  // ── Optional: Discord Bot ──────────────────────────────────────────────
  {
    name: "DISCORD_BOT_TOKEN",
    required: false,
    category: "Discord Bot",
    source: "human",
    description: "Discord bot token for OpenClaw gateway",
    url: "https://discord.com/developers/applications",
    steps: ["Your app", "Bot tab", "Reset Token", "Copy the new token"],
  },

  // ── Optional: Observability (Grafana Cloud) ────────────────────────────
  {
    name: "GRAFANA_URL",
    required: false,
    category: "Observability (Grafana Cloud)",
    source: "human",
    description: "Grafana instance URL",
    url: "https://grafana.com/orgs",
    steps: ['e.g. "https://your-org.grafana.net"'],
  },
  {
    name: "GRAFANA_SERVICE_ACCOUNT_TOKEN",
    required: false,
    category: "Observability (Grafana Cloud)",
    source: "human",
    description: "Grafana service account token (Viewer role)",
    steps: [
      "Grafana instance",
      "Administration -> Service Accounts",
      "Add service account (Viewer role)",
      "Add token, copy it",
    ],
  },
  {
    name: "GRAFANA_CLOUD_LOKI_URL",
    required: false,
    category: "Observability (Grafana Cloud)",
    source: "human",
    description: "Grafana Cloud Loki write URL",
    url: "https://grafana.com/orgs",
    steps: [
      "Your stack -> Loki",
      "Paste the base URL (e.g. https://logs-prod-020.grafana.net)",
      "/loki/api/v1/push will be appended automatically",
    ],
    /** Transform: append push path if missing */
    transform: (v: string) => {
      const base = v.replace(/\/+$/, "");
      return base.includes("/loki/api/v1/push")
        ? base
        : `${base}/loki/api/v1/push`;
    },
  },
  {
    name: "GRAFANA_CLOUD_LOKI_USER",
    required: false,
    category: "Observability (Grafana Cloud)",
    source: "human",
    description: "Grafana Cloud Loki numeric user ID",
    url: "https://grafana.com/orgs",
    steps: ["Your stack -> Loki", "Copy User (numeric)"],
  },
  {
    name: "GRAFANA_CLOUD_LOKI_API_KEY",
    required: false,
    category: "Observability (Grafana Cloud)",
    source: "human",
    description: "Grafana Cloud API key (logs:write scope)",
    url: "https://grafana.com/orgs",
    steps: [
      "Access Policies -> Create policy",
      "Scope: logs:write",
      "Create token, copy it",
    ],
  },
  {
    name: "PROMETHEUS_REMOTE_WRITE_URL",
    required: false,
    category: "Observability (Grafana Cloud)",
    source: "human",
    description: "Grafana Cloud Prometheus remote write URL",
    url: "https://grafana.com/orgs",
    steps: ["Your stack -> Prometheus", "Copy Remote Write URL"],
  },
  {
    name: "PROMETHEUS_USERNAME",
    required: false,
    category: "Observability (Grafana Cloud)",
    source: "human",
    description: "Grafana Cloud Prometheus user (numeric)",
    url: "https://grafana.com/orgs",
    steps: ["Your stack -> Prometheus", "Copy User (numeric)"],
  },
  {
    name: "PROMETHEUS_PASSWORD",
    required: false,
    category: "Observability (Grafana Cloud)",
    source: "human",
    description: "Grafana Cloud API key (metrics:write scope)",
    url: "https://grafana.com/orgs",
    steps: [
      "Access Policies -> Create policy",
      "Scope: metrics:write",
      "Create token, copy it",
    ],
  },
  {
    name: "PROMETHEUS_READ_USERNAME",
    required: false,
    category: "Observability (Grafana Cloud)",
    source: "human",
    description: "Prometheus read user (same numeric ID is fine)",
    steps: ["Same user ID as PROMETHEUS_USERNAME"],
  },
  {
    name: "PROMETHEUS_READ_PASSWORD",
    required: false,
    category: "Observability (Grafana Cloud)",
    source: "human",
    description: "Grafana Cloud API key (metrics:read scope)",
    url: "https://grafana.com/orgs",
    steps: [
      "Access Policies -> Create policy",
      "Scope: metrics:read",
      "Create token, copy it",
    ],
  },

  // ── Optional: Langfuse ─────────────────────────────────────────────────
  {
    name: "LANGFUSE_PUBLIC_KEY",
    required: false,
    category: "AI Observability (Langfuse)",
    source: "human",
    description: "Langfuse public key",
    url: "https://cloud.langfuse.com",
    steps: ["Settings -> API Keys", "Copy Public Key"],
  },
  {
    name: "LANGFUSE_SECRET_KEY",
    required: false,
    category: "AI Observability (Langfuse)",
    source: "human",
    description: "Langfuse secret key",
    url: "https://cloud.langfuse.com",
    steps: ["Settings -> API Keys", "Copy Secret Key"],
  },
  {
    name: "LANGFUSE_BASE_URL",
    required: false,
    category: "AI Observability (Langfuse)",
    source: "human",
    description: "Langfuse instance URL",
    steps: [
      'Default: "https://cloud.langfuse.com"',
      "Set only for self-hosted",
    ],
  },

  // ── Optional: Privy (Operator Wallet) ──────────────────────────────────
  {
    name: "PRIVY_APP_ID",
    required: false,
    category: "Operator Wallet (Privy)",
    source: "human",
    description: "Privy application ID",
    url: "https://dashboard.privy.io",
    steps: ["App Settings", "Copy App ID"],
  },
  {
    name: "PRIVY_APP_SECRET",
    required: false,
    category: "Operator Wallet (Privy)",
    source: "human",
    description: "Privy application secret",
    url: "https://dashboard.privy.io",
    steps: ["App Settings", "Copy App Secret"],
  },
  {
    name: "PRIVY_SIGNING_KEY",
    required: false,
    category: "Operator Wallet (Privy)",
    source: "human",
    description: "Privy EC signing key (PEM)",
    url: "https://dashboard.privy.io",
    steps: [
      "App Settings",
      "Copy Signing Key",
      "Paste full PEM including newlines",
    ],
  },

  // ── Optional: WalletConnect ────────────────────────────────────────────
  {
    name: "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    required: false,
    category: "WalletConnect",
    source: "human",
    description: "WalletConnect Cloud project ID",
    url: "https://cloud.walletconnect.com",
    steps: ["Your project", "Copy Project ID"],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const REPO = "Cogni-DAO/node-template";
/** Deploy environments. Secrets are set per-env, not repo-level. */
const ENVIRONMENTS = ["preview", "canary", "production"] as const;

/** Track secret values per environment for .env file generation */
const envSecretValues: Record<string, Record<string, string>> = {
  preview: {},
  canary: {},
  production: {},
};

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function envStatus(has: boolean): string {
  return has ? `${GREEN}set${RESET}` : `${RED}missing${RESET}`;
}

function getSetSecrets(env: string): Set<string> {
  try {
    const out = execSync(
      `gh secret list --repo ${REPO} --env ${env} 2>/dev/null`,
      {
        encoding: "utf-8",
      }
    );
    return new Set(
      out
        .split("\n")
        .map((l) => l.split("\t")[0])
        .filter(Boolean)
    );
  } catch {
    console.error(
      `Failed to list secrets for ${env}. Is \`gh\` authenticated?`
    );
    process.exit(1);
  }
}

function setSecret(name: string, value: string, env: string): boolean {
  try {
    execSync(`gh secret set ${name} --repo ${REPO} --env ${env}`, {
      input: value,
      encoding: "utf-8",
    });
    // Track for .env file generation
    if (env in envSecretValues) {
      envSecretValues[env]![name] = value;
    }
    return true;
  } catch (e) {
    console.error(`  Failed to set ${name} (${env}): ${e}`);
    return false;
  }
}

function setSecretBoth(
  name: string,
  value: string,
  envs: readonly string[] = ENVIRONMENTS
): boolean {
  let ok = true;
  for (const env of envs) {
    if (!setSecret(name, value, env)) ok = false;
  }
  return ok;
}

function setSecretRepo(name: string, value: string): boolean {
  try {
    execSync(`gh secret set ${name} --repo ${REPO}`, {
      input: value,
      encoding: "utf-8",
    });
    return true;
  } catch (e) {
    console.error(`  Failed to set ${name} (repo): ${e}`);
    return false;
  }
}

function getRepoSecrets(): Set<string> {
  try {
    const out = execSync(`gh secret list --repo ${REPO} 2>/dev/null`, {
      encoding: "utf-8",
    });
    return new Set(
      out
        .split("\n")
        .map((l) => l.split("\t")[0])
        .filter(Boolean)
    );
  } catch {
    console.error("Failed to list repo secrets. Is `gh` authenticated?");
    process.exit(1);
  }
}

async function prompt(
  rl: readline.Interface,
  question: string
): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

/** Apply secret.transform if defined, otherwise return as-is */
function applyTransform(secret: Secret, value: string): string {
  const v = value.trim();
  return secret.transform ? secret.transform(v) : v;
}

// ── Database DSN helpers ─────────────────────────────────────────────────────

const dbPasswords: Record<string, string> = {};

function buildDSNs(envs: readonly string[]): void {
  const appUser = dbPasswords["APP_DB_USER"] || "app_user";
  const appPw = dbPasswords["APP_DB_PASSWORD"];
  const svcUser = dbPasswords["APP_DB_SERVICE_USER"] || "app_service";
  const svcPw = dbPasswords["APP_DB_SERVICE_PASSWORD"];
  const dbName = dbPasswords["APP_DB_NAME"] || "cogni_template";
  const host = "postgres"; // Docker service name

  if (appPw) {
    const url = `postgresql://${appUser}:${appPw}@${host}:5432/${dbName}`;
    setSecretBoth("DATABASE_URL", url, envs);
    console.log(`  ${GREEN}DATABASE_URL${RESET} set (${envs.join(", ")})`);
  }
  if (svcPw) {
    const url = `postgresql://${svcUser}:${svcPw}@${host}:5432/${dbName}`;
    setSecretBoth("DATABASE_SERVICE_URL", url, envs);
    console.log(
      `  ${GREEN}DATABASE_SERVICE_URL${RESET} set (preview + production)`
    );
  }
}

// ── Display ──────────────────────────────────────────────────────────────────

function printInventory(
  previewSecrets: Set<string>,
  prodSecrets: Set<string>,
  repoSecrets: Set<string>
): void {
  console.log(`\n${BOLD}  Secret Inventory — ${REPO}${RESET}\n`);
  console.log(
    `  ${"SECRET".padEnd(42)} ${"LEVEL".padEnd(8)} ${"STATUS".padEnd(22)} ${"SOURCE"}`
  );
  console.log(
    `  ${"─".repeat(42)} ${"─".repeat(8)} ${"─".repeat(22)} ${"─".repeat(8)}`
  );

  let lastCategory = "";
  for (const s of SECRETS) {
    if (s.category !== lastCategory) {
      console.log(`\n  ${DIM}${s.category}${RESET}`);
      lastCategory = s.category;
    }
    const req = s.required ? "" : `${DIM}(opt)${RESET} `;
    const src =
      s.source === "agent" ? `${DIM}auto${RESET}` : `${YELLOW}human${RESET}`;

    if (s.repoLevel) {
      const rStatus = envStatus(repoSecrets.has(s.name));
      console.log(
        `  ${req}${s.name.padEnd(s.required ? 42 : 37)} ${DIM}repo${RESET}     ${rStatus.padEnd(31)} ${src}`
      );
    } else {
      const pStatus = envStatus(previewSecrets.has(s.name));
      const dStatus = envStatus(prodSecrets.has(s.name));
      console.log(
        `  ${req}${s.name.padEnd(s.required ? 42 : 37)} ${DIM}env${RESET}      pre:${pStatus} prod:${dStatus}  ${src}`
      );
    }
  }
  console.log("");
}

function printSecretHeader(
  secret: Secret,
  previewSecrets: Set<string>,
  prodSecrets: Set<string>,
  repoSecrets: Set<string>
): void {
  const reqTag = secret.required
    ? `${BOLD}[REQUIRED]${RESET}`
    : `${DIM}[optional]${RESET}`;

  console.log("");
  const statusLine = secret.repoLevel
    ? `[repo: ${envStatus(repoSecrets.has(secret.name))}]`
    : `[preview: ${envStatus(previewSecrets.has(secret.name))}, production: ${envStatus(prodSecrets.has(secret.name))}]`;
  console.log(`  ${reqTag} ${BOLD}${secret.name}${RESET}  ${statusLine}`);
  console.log(`  ${secret.description}`);

  if (secret.url) {
    console.log("");
    console.log(`     ${CYAN}${secret.url}${RESET}`);
    console.log("");
  }

  for (const step of secret.steps) {
    console.log(`     ${step}`);
  }
  console.log("");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const showAll = args.includes("--all");
  const filterRequired = args.includes("--required");
  // --only DISCORD,SONAR  or  --only DISCORD_OAUTH_CLIENT_ID
  const onlyArg =
    args.find((a) => a.startsWith("--only="))?.slice(7) ||
    (args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined);
  const onlyPatterns = onlyArg
    ?.split(",")
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);

  // --env canary  or  --env=canary  (target a single environment)
  const envArg =
    args.find((a) => a.startsWith("--env="))?.slice(6) ||
    (args.includes("--env") ? args[args.indexOf("--env") + 1] : undefined);
  const targetEnvs: (typeof ENVIRONMENTS)[number][] = envArg
    ? [envArg as (typeof ENVIRONMENTS)[number]]
    : [...ENVIRONMENTS];

  if (
    envArg &&
    !ENVIRONMENTS.includes(envArg as (typeof ENVIRONMENTS)[number])
  ) {
    console.error(
      `Unknown environment: ${envArg}. Must be one of: ${ENVIRONMENTS.join(", ")}`
    );
    process.exit(1);
  }

  if (envArg) {
    console.log(`  ${CYAN}Targeting environment: ${envArg}${RESET}\n`);
  }

  const previewSecrets = getSetSecrets("preview");
  const prodSecrets = getSetSecrets("production");
  const canarySecrets = getSetSecrets("canary");
  const repoSecrets = getRepoSecrets();

  // Always print full inventory first
  printInventory(previewSecrets, prodSecrets, repoSecrets);

  let filtered = SECRETS;
  if (onlyPatterns) {
    // --only DISCORD matches DISCORD_OAUTH_CLIENT_ID, DISCORD_BOT_TOKEN, etc.
    filtered = filtered.filter((s) =>
      onlyPatterns.some((p) => s.name.includes(p))
    );
  } else {
    if (filterRequired) {
      filtered = filtered.filter((s) => s.required);
    }
    if (!showAll) {
      filtered = filtered.filter((s) => {
        if (s.repoLevel) return !repoSecrets.has(s.name);
        return !previewSecrets.has(s.name) || !prodSecrets.has(s.name);
      });
    }
  }

  if (filtered.length === 0) {
    console.log(`  ${GREEN}All secrets are set in both environments.${RESET}`);
    console.log(`  Run with --all to walk through everything.\n`);
    return;
  }

  console.log(
    `  ${filtered.length} secret(s) to configure. Press Enter to skip any.\n`
  );
  console.log(`  ${"─".repeat(70)}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let set = 0;
  let skipped = 0;
  let lastCategory = "";

  for (const secret of filtered) {
    if (secret.category !== lastCategory) {
      console.log(
        `\n${"═".repeat(2)} ${BOLD}${secret.category}${RESET} ${"═".repeat(60 - secret.category.length)}`
      );
      lastCategory = secret.category;
    }

    printSecretHeader(secret, previewSecrets, prodSecrets, repoSecrets);

    // SSH_DEPLOY_KEY is special — one key per environment
    if (secret.name === "SSH_DEPLOY_KEY") {
      const action = await prompt(
        rl,
        `  Generate SSH keys for both environments? [Y/n] `
      );
      if (action.toLowerCase() === "n") {
        skipped++;
        continue;
      }
      for (const env of targetEnvs) {
        const privKey = generateSSHKey(env);
        setSecret(secret.name, privKey, env);
        console.log(`  ${GREEN}SSH_DEPLOY_KEY${RESET} set for ${env}`);
      }
      set++;
      continue;
    }

    // Repo-level secrets (CI, not deploy)
    if (secret.repoLevel) {
      const value = await prompt(
        rl,
        `  Paste value for ${BOLD}repo${RESET} (Enter to skip): `
      );
      if (!value.trim()) {
        skipped++;
        continue;
      }
      const final = applyTransform(secret, value);
      if (setSecretRepo(secret.name, final)) {
        if (final !== value.trim())
          console.log(`  ${DIM}(transformed: ${final})${RESET}`);
        console.log(`  ${GREEN}${secret.name}${RESET} set (repo-level)`);
        set++;
      }
      continue;
    }

    if (secret.source === "agent") {
      const action = await prompt(
        rl,
        `  Generate and set for both envs? [Y/n] `
      );
      if (action.toLowerCase() === "n") {
        skipped++;
        continue;
      }
      const value = secret.generate?.();
      if (setSecretBoth(secret.name, value, targetEnvs)) {
        console.log(
          `  ${GREEN}${secret.name}${RESET} set (${targetEnvs.join(", ")})`
        );
        set++;
        if (secret.category === "Database") {
          dbPasswords[secret.name] = value;
        }
      }
    } else if (secret.perEnv) {
      // Per-env human secrets (DOMAIN, VM_HOST) — ask for each env separately
      for (const env of targetEnvs) {
        const envSecrets =
          env === "preview"
            ? previewSecrets
            : env === "canary"
              ? canarySecrets
              : prodSecrets;
        const already = envSecrets.has(secret.name);
        if (already && !showAll) continue;
        const value = await prompt(
          rl,
          `  Value for ${BOLD}${env}${RESET} (Enter to skip): `
        );
        if (!value.trim()) continue;
        const final = applyTransform(secret, value);
        if (final !== value.trim())
          console.log(`  ${DIM}(transformed: ${final})${RESET}`);
        if (setSecret(secret.name, final, env)) {
          console.log(`  ${GREEN}${secret.name}${RESET} set for ${env}`);
          set++;
        }
      }
    } else {
      // Human secrets — ask per-environment
      const pMissing = !previewSecrets.has(secret.name);
      const dMissing = !prodSecrets.has(secret.name);

      // Determine which envs to prompt for
      let envsToSet: (typeof ENVIRONMENTS)[number][];
      if (pMissing && dMissing) {
        const envHint = `[${BOLD}B${RESET}]oth / [${BOLD}P${RESET}]review only / pro[${BOLD}D${RESET}] only / [${BOLD}S${RESET}]kip`;
        const target = await prompt(rl, `  Set for: ${envHint}: `);
        const t = target.toLowerCase().trim() || "b";
        if (t === "s") {
          skipped++;
          continue;
        }
        envsToSet =
          t === "p"
            ? ["preview"]
            : t === "d"
              ? ["production"]
              : [...ENVIRONMENTS];
      } else {
        envsToSet = pMissing ? ["preview"] : ["production"];
        console.log(`  ${DIM}(only missing in ${envsToSet[0]})${RESET}`);
      }

      // Prompt for each environment separately
      let didSet = false;
      for (const env of envsToSet) {
        const value = await prompt(
          rl,
          `  Paste value for ${BOLD}${env}${RESET} (Enter to skip): `
        );
        if (!value.trim()) continue;
        const final = applyTransform(secret, value);
        if (final !== value.trim())
          console.log(`  ${DIM}(transformed: ${final})${RESET}`);
        if (setSecret(secret.name, final, env)) {
          console.log(`  ${GREEN}${secret.name}${RESET} set for ${env}`);
          didSet = true;
        }
      }
      if (didSet) set++;
      else skipped++;
    }
  }

  // Build DATABASE_URL and DATABASE_SERVICE_URL from collected passwords
  if (
    dbPasswords["APP_DB_PASSWORD"] ||
    dbPasswords["APP_DB_SERVICE_PASSWORD"]
  ) {
    console.log(
      `\n${"═".repeat(2)} ${BOLD}Derived Database URLs${RESET} ${"═".repeat(41)}`
    );
    buildDSNs(targetEnvs);
  }

  // Write .env.{env} files for each environment that had secrets set
  const repoRoot = execSync("git rev-parse --show-toplevel", {
    encoding: "utf-8",
  }).trim();

  for (const env of targetEnvs) {
    const secrets = envSecretValues[env];
    if (!secrets || Object.keys(secrets).length === 0) continue;

    const envFile = `${repoRoot}/.env.${env}`;
    const lines = [
      `# Auto-generated by setup-secrets.ts — ${new Date().toISOString()}`,
      `# Source of truth for ${env} environment secrets.`,
      `# Read by: provision-test-vm.sh, deploy-infra.sh (via GitHub env)`,
      `# DO NOT commit this file (gitignored).`,
      "",
      ...Object.entries(secrets).map(
        ([k, v]) => `${k}='${v.replace(/'/g, "'\\''")}'`
      ),
      "",
    ];
    const { writeFileSync, chmodSync } = await import("node:fs");
    writeFileSync(envFile, lines.join("\n"));
    chmodSync(envFile, 0o600);
    console.log(
      `  ${GREEN}Saved${RESET} .env.${env} (${Object.keys(secrets).length} secrets)`
    );
  }

  console.log(
    `\n  Done. ${GREEN}${set} set${RESET}, ${DIM}${skipped} skipped${RESET}.\n`
  );
  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
