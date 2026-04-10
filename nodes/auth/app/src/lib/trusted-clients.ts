// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { authHubEnv } from "./env";

export interface TrustedAuthHubClient {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly name: string;
  readonly type: "web";
  readonly redirectUrls: string[];
  readonly disabled: false;
  readonly skipConsent: true;
  readonly subjectType: "public";
  readonly scopes: string[];
}

export function getTrustedAuthHubClients(): TrustedAuthHubClient[] {
  const env = authHubEnv();

  return [
    {
      clientId: env.AUTH_HUB_CLIENT_ID,
      clientSecret: env.AUTH_HUB_CLIENT_SECRET,
      name: "Cogni Operator Local",
      type: "web",
      redirectUrls: ["http://localhost:3000/api/auth/callback/github"],
      disabled: false,
      skipConsent: true,
      subjectType: "public",
      scopes: ["openid", "profile", "email", "offline_access"],
    },
    {
      clientId: env.AUTH_HUB_CLIENT_ID_POLY,
      clientSecret: env.AUTH_HUB_CLIENT_SECRET_POLY,
      name: "Cogni Poly Local",
      type: "web",
      redirectUrls: ["http://localhost:3100/api/auth/callback/github"],
      disabled: false,
      skipConsent: true,
      subjectType: "public",
      scopes: ["openid", "profile", "email", "offline_access"],
    },
    {
      clientId: env.AUTH_HUB_CLIENT_ID_RESY,
      clientSecret: env.AUTH_HUB_CLIENT_SECRET_RESY,
      name: "Cogni Resy Local",
      type: "web",
      redirectUrls: ["http://localhost:3300/api/auth/callback/github"],
      disabled: false,
      skipConsent: true,
      subjectType: "public",
      scopes: ["openid", "profile", "email", "offline_access"],
    },
  ];
}

let pendingClient: TrustedAuthHubClient | null = null;

function consumePendingClient(): TrustedAuthHubClient {
  if (!pendingClient) {
    throw new Error(
      "Attempted to generate an auth hub client credential without an active client bootstrap."
    );
  }

  return pendingClient;
}

export function generateTrustedClientId(): string {
  return consumePendingClient().clientId;
}

export function generateTrustedClientSecret(): string {
  return consumePendingClient().clientSecret;
}

export async function withPendingTrustedClient<T>(
  client: TrustedAuthHubClient,
  action: () => Promise<T>
): Promise<T> {
  if (pendingClient) {
    throw new Error(
      "Concurrent auth hub client bootstrap is not supported during prototype setup."
    );
  }

  pendingClient = client;

  try {
    return await action();
  } finally {
    pendingClient = null;
  }
}
