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
 *   pnpm setup:secrets                # walk through missing secrets
 *   pnpm setup:secrets --required     # only required secrets
 *   pnpm setup:secrets --all          # walk through everything (including already-set)
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
  /** Instructions shown to user */
  instructions: string;
  /** Generator function for agent secrets */
  generate?: () => string;
}

// ── Generators ───────────────────────────────────────────────────────────────

function rand64(bytes = 32): string {
  return execSync(`openssl rand -base64 ${bytes}`).toString().trim();
}

function randHex(bytes = 32): string {
  return execSync(`openssl rand -hex ${bytes}`).toString().trim();
}

function generateSSHKey(): string {
  const path = "/tmp/cogni-deploy-key-" + Date.now();
  execSync(
    `ssh-keygen -t ed25519 -f ${path} -N "" -C "cogni-deploy-$(date +%Y%m%d)" -q`
  );
  const privKey = execSync(`cat ${path}`).toString();
  const pubKey = execSync(`cat ${path}.pub`).toString().trim();
  execSync(`rm -f ${path} ${path}.pub`);
  console.log("\n  Public key (add to server ~/.ssh/authorized_keys):");
  console.log(`  ${pubKey}\n`);
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
    instructions: "Auto-generated random string.",
    generate: () => rand64(32),
  },
  {
    name: "LITELLM_MASTER_KEY",
    required: true,
    category: "Core App",
    source: "agent",
    description: "LiteLLM proxy master API key",
    instructions: "Auto-generated sk-cogni-* key.",
    generate: () => `sk-cogni-${randHex(24)}`,
  },
  {
    name: "OPENCLAW_GATEWAY_TOKEN",
    required: true,
    category: "Core App",
    source: "agent",
    description: "OpenClaw gateway WS auth token",
    instructions: "Auto-generated random string.",
    generate: () => rand64(32),
  },
  {
    name: "SCHEDULER_API_TOKEN",
    required: true,
    category: "Internal Service",
    source: "agent",
    description: "scheduler-worker -> internal graph API auth",
    instructions: "Auto-generated random string.",
    generate: () => rand64(32),
  },
  {
    name: "BILLING_INGEST_TOKEN",
    required: true,
    category: "Internal Service",
    source: "agent",
    description: "LiteLLM callback -> billing ingest endpoint auth",
    instructions: "Auto-generated random string.",
    generate: () => rand64(32),
  },
  {
    name: "INTERNAL_OPS_TOKEN",
    required: true,
    category: "Internal Service",
    source: "agent",
    description: "Deploy trigger -> governance schedule sync auth",
    instructions: "Auto-generated random string.",
    generate: () => rand64(32),
  },
  {
    name: "METRICS_TOKEN",
    required: true,
    category: "Internal Service",
    source: "agent",
    description: "Prometheus scrape -> /api/metrics auth",
    instructions: "Auto-generated random string.",
    generate: () => rand64(32),
  },
  {
    name: "GH_WEBHOOK_SECRET",
    required: true,
    category: "Internal Service",
    source: "agent",
    description: "GitHub webhook HMAC verification secret",
    instructions: "Auto-generated hex string.",
    generate: () => randHex(32),
  },
  {
    name: "SSH_DEPLOY_KEY",
    required: true,
    category: "Infrastructure",
    source: "agent",
    description: "SSH private key for deploy to server",
    instructions:
      "Auto-generated ed25519 keypair. You must add the public key to the server.",
    generate: generateSSHKey,
  },

  // ── Required: Human-provided ───────────────────────────────────────────
  {
    name: "OPENROUTER_API_KEY",
    required: true,
    category: "Core App",
    source: "human",
    description: "OpenRouter LLM API key",
    url: "https://openrouter.ai/keys",
    instructions: "Create a new API key. Copy the full key (starts with sk-).",
  },
  {
    name: "EVM_RPC_URL",
    required: true,
    category: "Core App",
    source: "human",
    description: "Base mainnet RPC endpoint for on-chain verification",
    url: "https://dashboard.alchemy.com/",
    instructions:
      "Create a new app (chain: Base mainnet). Copy the full HTTPS URL including API key.",
  },
  {
    name: "OPENCLAW_GITHUB_RW_TOKEN",
    required: true,
    category: "Core App",
    source: "human",
    description: "GitHub PAT for OpenClaw git relay (push + PR)",
    url: "https://github.com/settings/tokens?type=beta",
    instructions:
      "Fine-grained PAT. Scopes: Contents:Write + Pull requests:Write. Scoped to Cogni-DAO repos.",
  },
  {
    name: "POSTHOG_API_KEY",
    required: true,
    category: "Core App",
    source: "human",
    description: "PostHog project API key",
    url: "https://us.posthog.com/settings/project#variables",
    instructions: "Copy the Project API Key from project settings.",
  },
  {
    name: "POSTHOG_HOST",
    required: true,
    category: "Core App",
    source: "human",
    description: "PostHog instance URL",
    url: "https://us.posthog.com/settings/project#variables",
    instructions:
      'Your PostHog host URL (e.g. "https://us.i.posthog.com" for US Cloud).',
  },
  {
    name: "GHCR_DEPLOY_TOKEN",
    required: true,
    category: "Infrastructure",
    source: "human",
    description: "GitHub PAT for docker pull from GHCR on deploy server",
    url: "https://github.com/settings/tokens?type=beta",
    instructions:
      "Fine-grained PAT. Scope: Packages:Read. Scoped to Cogni-DAO.",
  },
  {
    name: "DOMAIN",
    required: true,
    category: "Infrastructure",
    source: "human",
    description: "Production server domain (e.g. app.cogni.dev)",
    instructions: "Your server's public domain name.",
  },
  {
    name: "VM_HOST",
    required: true,
    category: "Infrastructure",
    source: "human",
    description: "Deploy target IP or hostname",
    instructions: "The IP address or hostname of your production server.",
  },

  // ── Required: Database (grouped) ───────────────────────────────────────
  {
    name: "POSTGRES_ROOT_USER",
    required: true,
    category: "Database",
    source: "agent",
    description: "Postgres superuser name",
    instructions: 'Convention: "postgres".',
    generate: () => "postgres",
  },
  {
    name: "POSTGRES_ROOT_PASSWORD",
    required: true,
    category: "Database",
    source: "agent",
    description: "Postgres superuser password",
    instructions: "Auto-generated random string.",
    generate: () => rand64(24),
  },
  {
    name: "APP_DB_NAME",
    required: true,
    category: "Database",
    source: "agent",
    description: "Application database name",
    instructions: 'Convention: "cogni_template".',
    generate: () => "cogni_template",
  },
  {
    name: "APP_DB_USER",
    required: true,
    category: "Database",
    source: "agent",
    description: "App user (RLS enforced)",
    instructions: 'Convention: "app_user".',
    generate: () => "app_user",
  },
  {
    name: "APP_DB_PASSWORD",
    required: true,
    category: "Database",
    source: "agent",
    description: "App user password",
    instructions: "Auto-generated random string.",
    generate: () => rand64(24),
  },
  {
    name: "APP_DB_SERVICE_USER",
    required: true,
    category: "Database",
    source: "agent",
    description: "Service user (BYPASSRLS)",
    instructions: 'Convention: "app_service".',
    generate: () => "app_service",
  },
  {
    name: "APP_DB_SERVICE_PASSWORD",
    required: true,
    category: "Database",
    source: "agent",
    description: "Service user password",
    instructions: "Auto-generated random string.",
    generate: () => rand64(24),
  },
  {
    name: "TEMPORAL_DB_USER",
    required: true,
    category: "Database",
    source: "agent",
    description: "Temporal database user",
    instructions: 'Convention: "temporal".',
    generate: () => "temporal",
  },
  {
    name: "TEMPORAL_DB_PASSWORD",
    required: true,
    category: "Database",
    source: "agent",
    description: "Temporal database password",
    instructions: "Auto-generated random string.",
    generate: () => rand64(24),
  },

  // ── CI / Automation ────────────────────────────────────────────────────
  {
    name: "ACTIONS_AUTOMATION_BOT_PAT",
    required: false,
    category: "CI / Automation",
    source: "human",
    description: "GitHub PAT for cross-repo workflow dispatch and release PRs",
    url: "https://github.com/settings/tokens?type=beta",
    instructions:
      "Fine-grained PAT. Scopes: Actions:Write + Contents:Write + Pull requests:Write.",
  },
  {
    name: "GIT_READ_TOKEN",
    required: false,
    category: "CI / Automation",
    source: "human",
    description: "GitHub PAT for git-sync container (repo clone)",
    url: "https://github.com/settings/tokens?type=beta",
    instructions:
      "Fine-grained PAT. Scope: Contents:Read. (Public repos work without token.)",
  },
  {
    name: "SONAR_TOKEN",
    required: false,
    category: "CI / Automation",
    source: "human",
    description: "SonarCloud analysis token",
    url: "https://sonarcloud.io/account/security",
    instructions: "Generate a new token. Copy the full value.",
  },

  // ── Optional: GitHub App (PR Review Bot) ───────────────────────────────
  {
    name: "GH_REVIEW_APP_ID",
    required: false,
    category: "GitHub App (PR Review)",
    source: "human",
    description: "GitHub App numeric ID",
    url: "https://github.com/settings/apps",
    instructions: "Your GitHub App -> General -> App ID.",
  },
  {
    name: "GH_REVIEW_APP_PRIVATE_KEY_BASE64",
    required: false,
    category: "GitHub App (PR Review)",
    source: "human",
    description: "GitHub App private key (base64-encoded PEM)",
    url: "https://github.com/settings/apps",
    instructions:
      "GitHub App -> General -> Generate private key. Then: base64 -w0 < key.pem",
  },

  // ── Optional: OAuth Providers ──────────────────────────────────────────
  {
    name: "GH_OAUTH_CLIENT_ID",
    required: false,
    category: "OAuth (GitHub)",
    source: "human",
    description: "GitHub OAuth App client ID",
    url: "https://github.com/settings/developers",
    instructions: "OAuth Apps -> your app -> Client ID.",
  },
  {
    name: "GH_OAUTH_CLIENT_SECRET",
    required: false,
    category: "OAuth (GitHub)",
    source: "human",
    description: "GitHub OAuth App client secret",
    url: "https://github.com/settings/developers",
    instructions: "OAuth Apps -> your app -> Generate a new client secret.",
  },
  {
    name: "DISCORD_OAUTH_CLIENT_ID",
    required: false,
    category: "OAuth (Discord)",
    source: "human",
    description: "Discord OAuth2 client ID",
    url: "https://discord.com/developers/applications",
    instructions: "Your app -> OAuth2 -> Client ID.",
  },
  {
    name: "DISCORD_OAUTH_CLIENT_SECRET",
    required: false,
    category: "OAuth (Discord)",
    source: "human",
    description: "Discord OAuth2 client secret",
    url: "https://discord.com/developers/applications",
    instructions: "Your app -> OAuth2 -> Client Secret -> Reset.",
  },
  {
    name: "GOOGLE_OAUTH_CLIENT_ID",
    required: false,
    category: "OAuth (Google)",
    source: "human",
    description: "Google OAuth client ID",
    url: "https://console.cloud.google.com/apis/credentials",
    instructions: "OAuth 2.0 Client IDs -> your client -> Client ID.",
  },
  {
    name: "GOOGLE_OAUTH_CLIENT_SECRET",
    required: false,
    category: "OAuth (Google)",
    source: "human",
    description: "Google OAuth client secret",
    url: "https://console.cloud.google.com/apis/credentials",
    instructions: "OAuth 2.0 Client IDs -> your client -> Client secret.",
  },

  // ── Optional: Discord Bot ──────────────────────────────────────────────
  {
    name: "DISCORD_BOT_TOKEN",
    required: false,
    category: "Discord Bot",
    source: "human",
    description: "Discord bot token for OpenClaw gateway",
    url: "https://discord.com/developers/applications",
    instructions: "Your app -> Bot -> Reset Token. Copy the new token.",
  },

  // ── Optional: Observability (Grafana Cloud) ────────────────────────────
  {
    name: "GRAFANA_URL",
    required: false,
    category: "Observability",
    source: "human",
    description: "Grafana instance URL",
    instructions:
      'Your Grafana URL (e.g. "https://your-org.grafana.net").',
  },
  {
    name: "GRAFANA_SERVICE_ACCOUNT_TOKEN",
    required: false,
    category: "Observability",
    source: "human",
    description: "Grafana service account token (Viewer role)",
    instructions:
      "Grafana -> Administration -> Service Accounts -> Add token (Viewer role).",
  },
  {
    name: "GRAFANA_CLOUD_LOKI_URL",
    required: false,
    category: "Observability",
    source: "human",
    description: "Grafana Cloud Loki write URL",
    url: "https://grafana.com/orgs",
    instructions:
      "Grafana Cloud -> your stack -> Loki -> Data source URL + /loki/api/v1/push.",
  },
  {
    name: "GRAFANA_CLOUD_LOKI_USER",
    required: false,
    category: "Observability",
    source: "human",
    description: "Grafana Cloud Loki numeric user ID",
    url: "https://grafana.com/orgs",
    instructions: "Grafana Cloud -> your stack -> Loki -> User.",
  },
  {
    name: "GRAFANA_CLOUD_LOKI_API_KEY",
    required: false,
    category: "Observability",
    source: "human",
    description: "Grafana Cloud API key (logs:write scope)",
    url: "https://grafana.com/orgs",
    instructions:
      "Grafana Cloud -> Access Policies -> Create token with logs:write scope.",
  },
  {
    name: "PROMETHEUS_REMOTE_WRITE_URL",
    required: false,
    category: "Observability",
    source: "human",
    description: "Grafana Cloud Prometheus remote write URL",
    url: "https://grafana.com/orgs",
    instructions: "Grafana Cloud -> your stack -> Prometheus -> Remote Write URL.",
  },
  {
    name: "PROMETHEUS_USERNAME",
    required: false,
    category: "Observability",
    source: "human",
    description: "Grafana Cloud Prometheus user (numeric)",
    url: "https://grafana.com/orgs",
    instructions: "Grafana Cloud -> your stack -> Prometheus -> User.",
  },
  {
    name: "PROMETHEUS_PASSWORD",
    required: false,
    category: "Observability",
    source: "human",
    description: "Grafana Cloud API key (metrics:write scope)",
    url: "https://grafana.com/orgs",
    instructions: "Access Policies -> Create token with metrics:write scope.",
  },
  {
    name: "PROMETHEUS_READ_USERNAME",
    required: false,
    category: "Observability",
    source: "human",
    description: "Prometheus read user (same numeric ID is fine)",
    instructions: "Same user ID as PROMETHEUS_USERNAME.",
  },
  {
    name: "PROMETHEUS_READ_PASSWORD",
    required: false,
    category: "Observability",
    source: "human",
    description: "Grafana Cloud API key (metrics:read scope)",
    url: "https://grafana.com/orgs",
    instructions: "Access Policies -> Create token with metrics:read scope.",
  },

  // ── Optional: Langfuse ─────────────────────────────────────────────────
  {
    name: "LANGFUSE_PUBLIC_KEY",
    required: false,
    category: "AI Observability (Langfuse)",
    source: "human",
    description: "Langfuse public key",
    url: "https://cloud.langfuse.com",
    instructions: "Settings -> API Keys -> Public Key.",
  },
  {
    name: "LANGFUSE_SECRET_KEY",
    required: false,
    category: "AI Observability (Langfuse)",
    source: "human",
    description: "Langfuse secret key",
    url: "https://cloud.langfuse.com",
    instructions: "Settings -> API Keys -> Secret Key.",
  },
  {
    name: "LANGFUSE_BASE_URL",
    required: false,
    category: "AI Observability (Langfuse)",
    source: "human",
    description: "Langfuse instance URL",
    instructions:
      'Default: "https://cloud.langfuse.com". Set only for self-hosted.',
  },

  // ── Optional: Privy (Operator Wallet) ──────────────────────────────────
  {
    name: "PRIVY_APP_ID",
    required: false,
    category: "Operator Wallet (Privy)",
    source: "human",
    description: "Privy application ID",
    url: "https://dashboard.privy.io",
    instructions: "App Settings -> App ID.",
  },
  {
    name: "PRIVY_APP_SECRET",
    required: false,
    category: "Operator Wallet (Privy)",
    source: "human",
    description: "Privy application secret",
    url: "https://dashboard.privy.io",
    instructions: "App Settings -> App Secret.",
  },
  {
    name: "PRIVY_SIGNING_KEY",
    required: false,
    category: "Operator Wallet (Privy)",
    source: "human",
    description: "Privy EC signing key (PEM)",
    url: "https://dashboard.privy.io",
    instructions:
      "App Settings -> Signing Key. Paste the full PEM (with newlines).",
  },

  // ── Optional: WalletConnect ────────────────────────────────────────────
  {
    name: "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    required: false,
    category: "WalletConnect",
    source: "human",
    description: "WalletConnect Cloud project ID",
    url: "https://cloud.walletconnect.com",
    instructions: "Your project -> Project ID.",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const REPO = "Cogni-DAO/node-template";
/** Deploy environments. Secrets are set per-env, not repo-level. */
const ENVIRONMENTS = ["preview", "production"] as const;

function getSetSecrets(env?: string): Set<string> {
  try {
    const envFlag = env ? ` --env ${env}` : "";
    const out = execSync(`gh secret list --repo ${REPO}${envFlag} 2>/dev/null`, {
      encoding: "utf-8",
    });
    return new Set(out.split("\n").map((l) => l.split("\t")[0]).filter(Boolean));
  } catch {
    console.error(`Failed to list secrets${env ? ` for ${env}` : ""}. Is \`gh\` authenticated?`);
    process.exit(1);
  }
}

function setSecret(name: string, value: string, env?: string): boolean {
  try {
    const envFlag = env ? ` --env ${env}` : "";
    execSync(`gh secret set ${name} --repo ${REPO}${envFlag}`, {
      input: value,
      encoding: "utf-8",
    });
    return true;
  } catch (e) {
    console.error(`  Failed to set ${name}${env ? ` (${env})` : ""}: ${e}`);
    return false;
  }
}

/** Set a secret in both deploy environments (preview + production) */
function setSecretEverywhere(name: string, value: string): boolean {
  let ok = true;
  for (const env of ENVIRONMENTS) {
    if (!setSecret(name, value, env)) ok = false;
  }
  return ok;
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ── Database DSN helpers ─────────────────────────────────────────────────────

const dbPasswords: Record<string, string> = {};

function buildDSNs(): void {
  const appUser = dbPasswords["APP_DB_USER"] || "app_user";
  const appPw = dbPasswords["APP_DB_PASSWORD"];
  const svcUser = dbPasswords["APP_DB_SERVICE_USER"] || "app_service";
  const svcPw = dbPasswords["APP_DB_SERVICE_PASSWORD"];
  const dbName = dbPasswords["APP_DB_NAME"] || "cogni_template";
  const host = "postgres"; // Docker service name

  if (appPw) {
    const url = `postgresql://${appUser}:${appPw}@${host}:5432/${dbName}`;
    setSecretEverywhere("DATABASE_URL", url);
    console.log("  -> DATABASE_URL set (preview + production)");
  }
  if (svcPw) {
    const url = `postgresql://${svcUser}:${svcPw}@${host}:5432/${dbName}`;
    setSecretEverywhere("DATABASE_SERVICE_URL", url);
    console.log("  -> DATABASE_SERVICE_URL set (preview + production)");
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const showAll = args.includes("--all");
  const filterRequired = args.includes("--required");

  const previewSecrets = getSetSecrets("preview");
  const prodSecrets = getSetSecrets("production");

  let filtered = SECRETS;
  if (filterRequired) {
    filtered = filtered.filter((s) => s.required);
  }
  if (!showAll) {
    // Default: only show secrets missing from at least one environment
    filtered = filtered.filter(
      (s) => !previewSecrets.has(s.name) || !prodSecrets.has(s.name)
    );
  }

  console.log(`\n  Secret Rotation — ${REPO}`);
  console.log(`  Environments: preview, production`);
  console.log(`  ${filtered.length} secrets to process\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let set = 0;
  let skipped = 0;
  let lastCategory = "";

  for (const secret of filtered) {
    if (secret.category !== lastCategory) {
      console.log(`\n── ${secret.category} ${"─".repeat(60 - secret.category.length)}`);
      lastCategory = secret.category;
    }

    const p = previewSecrets.has(secret.name) ? "P" : "-";
    const d = prodSecrets.has(secret.name) ? "D" : "-";
    const marker = ` [${p}${d}]`; // P=preview, D=production
    const reqTag = secret.required ? "[REQUIRED]" : "[optional]";

    console.log(`\n  ${reqTag} ${secret.name}${marker}`);
    console.log(`  ${secret.description}`);
    if (secret.url) {
      console.log(`  URL: ${secret.url}`);
    }
    console.log(`  ${secret.instructions}`);

    if (secret.source === "agent") {
      const action = await prompt(
        rl,
        `  Generate and set? [Y/n/skip] `
      );
      if (action.toLowerCase() === "n" || action.toLowerCase() === "skip") {
        skipped++;
        continue;
      }
      const value = secret.generate!();
      if (setSecretEverywhere(secret.name, value)) {
        console.log(`  -> ${secret.name} set (preview + production)`);
        set++;
        // Track DB passwords for DSN construction
        if (secret.category === "Database") {
          dbPasswords[secret.name] = value;
        }
      }
    } else {
      const value = await prompt(
        rl,
        `  Paste value (or press Enter to skip): `
      );
      if (!value.trim()) {
        skipped++;
        continue;
      }
      if (setSecret(secret.name, value.trim())) {
        console.log(`  -> ${secret.name} set`);
        set++;
      }
    }
  }

  // Build DATABASE_URL and DATABASE_SERVICE_URL from collected passwords
  if (dbPasswords["APP_DB_PASSWORD"] || dbPasswords["APP_DB_SERVICE_PASSWORD"]) {
    console.log("\n── Derived Database URLs ──────────────────────────────────");
    buildDSNs();
  }

  console.log(`\n  Done. ${set} set, ${skipped} skipped.\n`);
  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
