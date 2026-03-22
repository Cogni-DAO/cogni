#!/usr/bin/env node
/**
 * OpenAI Codex OAuth Login
 *
 * Runs the PKCE OAuth flow to obtain access/refresh tokens for a ChatGPT
 * subscription (Plus/Pro/Team). Stores tokens in .env.local so LiteLLM
 * can route Codex model requests using your subscription.
 *
 * Usage: pnpm codex:login
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loginOpenAICodex, refreshOpenAICodexToken } from "@mariozechner/pi-ai/oauth";

const ENV_FILE = resolve(import.meta.dirname, "../../.env.local");

const CODEX_KEYS = [
  "CODEX_ACCESS_TOKEN",
  "CODEX_REFRESH_TOKEN",
  "CODEX_EXPIRES_AT",
  "CODEX_ACCOUNT_ID",
] as const;

function readEnvFile(): string {
  if (!existsSync(ENV_FILE)) return "";
  return readFileSync(ENV_FILE, "utf-8");
}

function upsertEnvVars(content: string, vars: Record<string, string>): string {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    const line = `${key}=${value}`;
    if (regex.test(result)) {
      result = result.replace(regex, line);
    } else {
      result = result.trimEnd() + "\n" + line + "\n";
    }
  }
  return result;
}

function writeTokens(creds: {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}) {
  let content = readEnvFile();
  content = upsertEnvVars(content, {
    CODEX_ACCESS_TOKEN: creds.access,
    CODEX_REFRESH_TOKEN: creds.refresh,
    CODEX_EXPIRES_AT: String(creds.expires),
    ...(creds.accountId ? { CODEX_ACCOUNT_ID: creds.accountId } : {}),
  });
  writeFileSync(ENV_FILE, content, "utf-8");
}

function readStoredTokens(): {
  access?: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
} | null {
  const content = readEnvFile();
  const get = (key: string) => {
    const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
    return match?.[1]?.trim();
  };
  const refresh = get("CODEX_REFRESH_TOKEN");
  if (!refresh) return null;
  return {
    access: get("CODEX_ACCESS_TOKEN"),
    refresh,
    expires: Number(get("CODEX_EXPIRES_AT")) || 0,
    accountId: get("CODEX_ACCOUNT_ID"),
  };
}

async function tryRefresh(): Promise<boolean> {
  const stored = readStoredTokens();
  if (!stored?.refresh) return false;

  // Still valid? (with 5min buffer)
  if (stored.expires && Date.now() < stored.expires - 5 * 60 * 1000) {
    const remaining = Math.round((stored.expires - Date.now()) / 60000);
    console.log(`Token still valid (${remaining}min remaining). Use --force to re-login.`);
    return true;
  }

  console.log("Refreshing expired token...");
  try {
    const refreshed = await refreshOpenAICodexToken(stored.refresh);
    writeTokens({
      access: refreshed.access,
      refresh: refreshed.refresh,
      expires: refreshed.expires,
      accountId: (refreshed as Record<string, unknown>).accountId as string | undefined,
    });
    console.log("Token refreshed successfully.");
    return true;
  } catch (err) {
    console.warn("Refresh failed, will do full login:", (err as Error).message);
    return false;
  }
}

async function fullLogin() {
  console.log("\nStarting OpenAI Codex OAuth flow...");
  console.log("A browser window will open. Sign in with your ChatGPT account.\n");

  const { exec } = await import("node:child_process");

  const creds = await loginOpenAICodex({
    onAuth: ({ url }) => {
      console.log("Opening browser for authentication...");
      // macOS native open; falls back to printing URL
      exec(`open "${url}"`, (err) => {
        if (err) console.log(`\nOpen this URL in your browser:\n\n  ${url}\n`);
      });
    },
    onPrompt: async ({ message }) => {
      // Simple stdin prompt
      process.stdout.write(`${message} `);
      return new Promise((resolve) => {
        let data = "";
        process.stdin.setEncoding("utf-8");
        process.stdin.once("data", (chunk: string) => {
          data = chunk.trim();
          resolve(data);
        });
        process.stdin.resume();
      });
    },
    onProgress: (msg) => console.log(`  ${msg}`),
  });

  writeTokens({
    access: creds.access,
    refresh: creds.refresh,
    expires: creds.expires,
    accountId: (creds as Record<string, unknown>).accountId as string | undefined,
  });

  const expiresIn = Math.round((creds.expires - Date.now()) / 60000);
  console.log(`\nLogin successful!`);
  console.log(`  Token expires in: ${expiresIn} minutes`);
  console.log(`  Account ID: ${(creds as Record<string, unknown>).accountId ?? "unknown"}`);
  console.log(`  Stored in: .env.local`);
  console.log(`\nRestart your dev:stack to pick up the new token.`);
}

// --- Main ---
const force = process.argv.includes("--force");
const refreshOnly = process.argv.includes("--refresh");

if (refreshOnly) {
  const ok = await tryRefresh();
  if (!ok) {
    console.error("No valid refresh token found. Run: pnpm codex:login");
    process.exit(1);
  }
} else if (!force) {
  const refreshed = await tryRefresh();
  if (refreshed) process.exit(0);
  await fullLogin();
} else {
  await fullLogin();
}
