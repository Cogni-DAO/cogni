/**
 * Load environment from the repo root .env.local
 * We need OPERATOR_PRIVATE_KEY and OPERATOR_WALLET_ADDRESS
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load from the main repo root .env.local (worktree is under .claude/worktrees/)
const repoRoot = resolve(__dirname, "../../../../../../");
config({ path: resolve(repoRoot, ".env.local") });

export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing env var: ${name}. Check .env.local`);
  return val;
}

const rawKey = requireEnv("OPERATOR_PRIVATE_KEY");
export const OPERATOR_PRIVATE_KEY: `0x${string}` = rawKey.startsWith("0x")
  ? (rawKey as `0x${string}`)
  : (`0x${rawKey}` as `0x${string}`);

const rawAddr = requireEnv("OPERATOR_WALLET_ADDRESS");
export const OPERATOR_WALLET_ADDRESS: `0x${string}` = rawAddr.startsWith("0x")
  ? (rawAddr as `0x${string}`)
  : (`0x${rawAddr}` as `0x${string}`);
