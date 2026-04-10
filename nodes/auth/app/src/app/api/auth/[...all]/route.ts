// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { toNextJsHandler } from "better-auth/next-js";

import { auth, ensureAuthHubClients } from "../../../../lib/auth";

export const runtime = "nodejs";

const handler = toNextJsHandler(auth);

export async function GET(...args: Parameters<typeof handler.GET>) {
  await ensureAuthHubClients();
  return handler.GET(...args);
}

export async function POST(...args: Parameters<typeof handler.POST>) {
  await ensureAuthHubClients();
  return handler.POST(...args);
}
