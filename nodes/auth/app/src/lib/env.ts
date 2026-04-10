// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { z } from "zod";

const authHubEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  AUTH_HUB_BASE_URL: z.string().url(),
  AUTH_HUB_SECRET: z.string().min(32),
  AUTH_DATABASE_URL: z.string().min(1),
  AUTH_GITHUB_CLIENT_ID: z.string().min(1),
  AUTH_GITHUB_CLIENT_SECRET: z.string().min(1),
  AUTH_HUB_CLIENT_ID: z.string().min(1),
  AUTH_HUB_CLIENT_SECRET: z.string().min(1),
  AUTH_HUB_CLIENT_ID_POLY: z.string().min(1),
  AUTH_HUB_CLIENT_SECRET_POLY: z.string().min(1),
  AUTH_HUB_CLIENT_ID_RESY: z.string().min(1),
  AUTH_HUB_CLIENT_SECRET_RESY: z.string().min(1),
});

let cachedEnv: z.infer<typeof authHubEnvSchema> | null = null;

export function authHubEnv() {
  // biome-ignore lint/style/noProcessEnv: auth hub env loader validates runtime env lazily
  cachedEnv ??= authHubEnvSchema.parse(process.env);
  return cachedEnv;
}

export type AuthHubEnv = z.infer<typeof authHubEnvSchema>;
