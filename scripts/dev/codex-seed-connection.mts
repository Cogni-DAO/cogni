#!/usr/bin/env node
/**
 * Seed a BYO-AI connection from Codex CLI auth.
 *
 * Reads tokens from ~/.codex/auth.json (written by `codex login` or `pnpm codex:login`),
 * encrypts them with AEAD, and inserts a connections row for the first user's billing account.
 *
 * Prerequisites:
 *   1. `codex login` or `pnpm codex:login` (to get tokens)
 *   2. Database running with connections table (pnpm db:migrate)
 *   3. CONNECTIONS_ENCRYPTION_KEY in .env.local (auto-generated if missing)
 *
 * Usage: pnpm codex:seed-connection
 */

import { randomBytes, randomUUID, createCipheriv } from "node:crypto";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import pg from "pg";

const ENV_FILE = resolve(import.meta.dirname, "../../.env.local");
const AUTH_JSON = join(homedir(), ".codex", "auth.json");

interface CodexAuth {
  auth_mode: string;
  tokens: {
    access_token: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: number;
}

async function readCodexAuth(): Promise<CodexAuth> {
  if (!existsSync(AUTH_JSON)) {
    console.log("No Codex auth found. Running codex login...\n");
    const { execSync } = await import("node:child_process");
    execSync("codex login", { stdio: "inherit" });
    if (!existsSync(AUTH_JSON)) {
      console.error("codex login did not create auth.json. Aborting.");
      process.exit(1);
    }
  }
  return JSON.parse(readFileSync(AUTH_JSON, "utf-8")) as CodexAuth;
}

function readEnvFile(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) result[match[1]] = match[2].trim();
  }
  return result;
}

async function main() {
  const auth = await readCodexAuth();
  const envVars = readEnvFile();

  if (!auth.tokens.access_token) {
    console.error("No access_token in ~/.codex/auth.json");
    console.error("Run: codex login");
    process.exit(1);
  }

  // Encryption key — auto-generate if missing
  let encKeyHex = envVars.CONNECTIONS_ENCRYPTION_KEY;
  if (!encKeyHex) {
    encKeyHex = randomBytes(32).toString("hex");
    appendFileSync(ENV_FILE, `\nCONNECTIONS_ENCRYPTION_KEY=${encKeyHex}\n`);
    console.log("Generated CONNECTIONS_ENCRYPTION_KEY → .env.local");
  }

  const encKey = Buffer.from(encKeyHex, "hex");
  if (encKey.length !== 32) {
    console.error("CONNECTIONS_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
    process.exit(1);
  }

  const dbUrl = envVars.DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not set in .env.local or environment");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: dbUrl });

  try {
    // Ensure connections table exists (run migration if needed)
    const { rows: tableCheck } = await pool.query(
      "SELECT to_regclass('public.connections') AS exists"
    );
    if (!tableCheck[0]?.exists) {
      console.log("connections table missing — running db:migrate...\n");
      const { execSync } = await import("node:child_process");
      execSync("pnpm db:migrate", {
        stdio: "inherit",
        cwd: resolve(import.meta.dirname, "../.."),
      });
    }
    // Find first user's billing account
    const { rows: accounts } = await pool.query(
      "SELECT id, owner_user_id FROM billing_accounts LIMIT 1"
    );
    if (accounts.length === 0) {
      console.error("No billing accounts found. Sign in to the app first.");
      process.exit(1);
    }
    const billingAccountId = accounts[0].id;
    const userId = accounts[0].owner_user_id;

    // Check for existing active connection
    const { rows: existing } = await pool.query(
      "SELECT id FROM connections WHERE billing_account_id = $1 AND provider = 'openai-chatgpt' AND revoked_at IS NULL",
      [billingAccountId]
    );

    // Build credential blob (matches broker's CredentialBlob shape)
    const credBlob = JSON.stringify({
      access_token: auth.tokens.access_token,
      refresh_token: auth.tokens.refresh_token ?? "",
      account_id: auth.tokens.account_id ?? "",
    });

    // Determine connection ID (reuse existing or generate new)
    const connectionId = existing[0]?.id ?? randomUUID();
    const isUpdate = existing.length > 0;

    // AEAD encrypt with AAD binding
    const aad = JSON.stringify({
      billing_account_id: billingAccountId,
      connection_id: connectionId,
      provider: "openai-chatgpt",
    });
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encKey, nonce, {
      authTagLength: 16,
    });
    cipher.setAAD(Buffer.from(aad, "utf-8"));
    const encrypted = Buffer.concat([
      cipher.update(credBlob, "utf-8"),
      cipher.final(),
    ]);
    const blob = Buffer.concat([nonce, encrypted, cipher.getAuthTag()]);

    if (isUpdate) {
      await pool.query(
        "UPDATE connections SET encrypted_credentials = $1, encryption_key_id = 'v1' WHERE id = $2",
        [blob, connectionId]
      );
      console.log(`\nUpdated connection: ${connectionId}`);
    } else {
      await pool.query(
        `INSERT INTO connections (id, billing_account_id, provider, credential_type, encrypted_credentials, encryption_key_id, scopes, created_by_user_id)
         VALUES ($1, $2, 'openai-chatgpt', 'oauth2', $3, 'v1', ARRAY['openid','profile','email','offline_access'], $4)`,
        [connectionId, billingAccountId, blob, userId]
      );
      console.log(`\nCreated connection: ${connectionId}`);
    }

    console.log(`  Billing Account: ${billingAccountId}`);
    console.log(`  Provider: openai-chatgpt`);
    console.log(`  Account ID: ${auth.tokens.account_id ?? "unknown"}`);
    console.log(`\nBYO-AI ready. Restart dev:stack to activate.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
