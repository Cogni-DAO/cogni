#!/usr/bin/env node

/**
 * Seed OpenClaw gateway with Codex OAuth credentials
 *
 * Reads tokens from .env.local (written by codex-login.mts) and writes
 * auth-profiles.json into the OpenClaw gateway container so it can use
 * Codex models via the native WebSocket transport.
 *
 * Usage: pnpm codex:seed
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(import.meta.dirname, "../../.env.local");
const CONTAINER = "openclaw-gateway";
const PROFILE_PATH =
  "/workspace/.openclaw-state/agents/main/agent/auth-profiles.json";

function readEnv(key: string): string | undefined {
  const content = readFileSync(ENV_FILE, "utf-8");
  const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match?.[1]?.trim();
}

const access = readEnv("CODEX_ACCESS_TOKEN");
const refresh = readEnv("CODEX_REFRESH_TOKEN");
const expires = Number(readEnv("CODEX_EXPIRES_AT")) || 0;
const accountId = readEnv("CODEX_ACCOUNT_ID");

if (!access || !refresh) {
  console.error("No Codex tokens found in .env.local. Run: pnpm codex:login");
  process.exit(1);
}

// Build auth-profiles.json in OpenClaw's expected format
const profileId = `openai-codex:${accountId ?? "default"}`;
const authProfiles = {
  version: 1,
  profiles: {
    [profileId]: {
      type: "oauth",
      provider: "openai-codex",
      access,
      refresh,
      expires,
      ...(accountId ? { accountId } : {}),
    },
  },
};

const json = JSON.stringify(authProfiles, null, 2);

// Check container is running
try {
  execSync(`docker inspect ${CONTAINER} --format='{{.State.Running}}'`, {
    stdio: "pipe",
  });
} catch {
  console.error(
    `Container '${CONTAINER}' is not running. Start dev:stack first.`
  );
  process.exit(1);
}

// Ensure the directory exists and write the file
execSync(
  `docker exec ${CONTAINER} mkdir -p /workspace/.openclaw-state/agents/main/agent`,
  { stdio: "inherit" }
);

// Write via stdin to avoid shell escaping issues
execSync(`docker exec -i ${CONTAINER} sh -c 'cat > ${PROFILE_PATH}'`, {
  input: json,
  stdio: ["pipe", "inherit", "inherit"],
});

console.log(`Codex auth profile seeded into ${CONTAINER}`);
console.log(`  Profile ID: ${profileId}`);
console.log(`  Expires: ${new Date(expires).toISOString()}`);
console.log(`\nRestart the gateway to pick it up:`);
console.log(`  docker restart ${CONTAINER}`);
