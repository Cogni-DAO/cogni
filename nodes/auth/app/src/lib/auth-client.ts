// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

let cachedAuthClient: ReturnType<typeof createAuthClient> | null = null;

export function getAuthClient() {
  if (typeof window === "undefined") {
    throw new Error("AUTH_HUB_CLIENT_BROWSER_ONLY");
  }

  cachedAuthClient ??= createAuthClient({
    baseURL: `${window.location.origin}/api/auth`,
    plugins: [oauthProviderClient()],
  });

  return cachedAuthClient;
}
