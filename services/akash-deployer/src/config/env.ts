// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/config`
 * Purpose: Environment configuration for the Akash deployer service.
 * Scope: Config loading — validates env vars at startup. Does NOT perform network calls.
 * Invariants: none
 * Side-effects: io
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(9100),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Akash network config
  AKASH_NODE: z.string().default("https://rpc.akashnet.net:443"),
  AKASH_CHAIN_ID: z.string().default("akashnet-2"),
  AKASH_KEY_NAME: z.string().default("deployer"),
  AKASH_KEYRING_BACKEND: z.string().default("test"),
  AKASH_HOME: z.string().optional(),
  AKASH_GAS_PRICES: z.string().default("0.025uakt"),

  // Cosmos wallet (for automated funding)
  COSMOS_MNEMONIC: z.string().optional(),
  COSMOS_RPC_ENDPOINT: z.string().default("https://rpc.akashnet.net:443"),

  // Internal auth
  INTERNAL_OPS_TOKEN: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadConfig(): EnvConfig {
  return envSchema.parse(process.env);
}
