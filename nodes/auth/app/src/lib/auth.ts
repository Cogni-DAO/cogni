// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { oauthProvider } from "@better-auth/oauth-provider";
import {
  AUTH_HUB_GITHUB_ID_CLAIM,
  AUTH_HUB_GITHUB_LOGIN_CLAIM,
  AUTH_HUB_PROVIDER_CLAIM,
} from "@cogni/node-shared";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { Pool } from "pg";

import { authHubEnv } from "./env";
import {
  generateTrustedClientId,
  generateTrustedClientSecret,
  getTrustedAuthHubClients,
  type TrustedAuthHubClient,
  withPendingTrustedClient,
} from "./trusted-clients";

const env = authHubEnv();

export const authDbPool = new Pool({
  connectionString: env.AUTH_DATABASE_URL,
});

export const auth = betterAuth({
  baseURL: env.AUTH_HUB_BASE_URL,
  secret: env.AUTH_HUB_SECRET,
  database: authDbPool,
  disabledPaths: ["/token"],
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
  user: {
    additionalFields: {
      provider: {
        type: "string",
        input: false,
      },
      githubId: {
        type: "string",
        input: false,
      },
      githubLogin: {
        type: "string",
        input: false,
      },
    },
  },
  socialProviders: {
    github: {
      clientId: env.AUTH_GITHUB_CLIENT_ID,
      clientSecret: env.AUTH_GITHUB_CLIENT_SECRET,
      overrideUserInfoOnSignIn: true,
      mapProfileToUser: (profile) => {
        const githubProfile = profile as {
          id: number | string;
          login: string;
          name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
        };

        return {
          name: githubProfile.name ?? githubProfile.login,
          email: githubProfile.email ?? null,
          provider: "github",
          githubId: String(githubProfile.id),
          githubLogin: githubProfile.login,
          ...(githubProfile.avatar_url
            ? { image: githubProfile.avatar_url }
            : {}),
        };
      },
    },
  },
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      cachedTrustedClients: new Set(
        getTrustedAuthHubClients().map((client) => client.clientId)
      ),
      generateClientId: generateTrustedClientId,
      generateClientSecret: generateTrustedClientSecret,
      scopes: ["openid", "profile", "email", "offline_access"],
      customIdTokenClaims: ({ user }) => ({
        [AUTH_HUB_PROVIDER_CLAIM]: "github",
        [AUTH_HUB_GITHUB_ID_CLAIM]: user.githubId,
        [AUTH_HUB_GITHUB_LOGIN_CLAIM]: user.githubLogin,
      }),
      customUserInfoClaims: ({ user }) => ({
        [AUTH_HUB_PROVIDER_CLAIM]: "github",
        [AUTH_HUB_GITHUB_ID_CLAIM]: user.githubId,
        [AUTH_HUB_GITHUB_LOGIN_CLAIM]: user.githubLogin,
      }),
      advertisedMetadata: {
        claims_supported: [
          AUTH_HUB_PROVIDER_CLAIM,
          AUTH_HUB_GITHUB_ID_CLAIM,
          AUTH_HUB_GITHUB_LOGIN_CLAIM,
        ],
      },
    }),
  ],
});

interface AuthHubApi {
  api: {
    adminCreateOAuthClient: (input: {
      body: {
        redirect_uris: string[];
        scope: string;
        client_name: string;
        token_endpoint_auth_method: "client_secret_basic";
        grant_types: ("authorization_code" | "refresh_token")[];
        response_types: "code"[];
        type: "web";
        skip_consent: true;
        subject_type: "public";
      };
    }) => Promise<unknown>;
  };
}

function toOAuthClientPayload(client: TrustedAuthHubClient) {
  return {
    redirect_uris: client.redirectUrls,
    scope: client.scopes.join(" "),
    client_name: client.name,
    token_endpoint_auth_method: "client_secret_basic" as const,
    grant_types: ["authorization_code", "refresh_token"] as (
      | "authorization_code"
      | "refresh_token"
    )[],
    response_types: ["code"] as "code"[],
    type: client.type,
    skip_consent: client.skipConsent,
    subject_type: client.subjectType,
  };
}

let ensuredClientsPromise: Promise<void> | null = null;

async function oauthClientExists(clientId: string): Promise<boolean> {
  const { rowCount } = await authDbPool.query(
    'select 1 from "oauthClient" where "clientId" = $1 limit 1',
    [clientId]
  );
  return (rowCount ?? 0) > 0;
}

async function ensureAuthHubClientsInner(): Promise<void> {
  const authWithApi = auth as typeof auth & AuthHubApi;

  for (const client of getTrustedAuthHubClients()) {
    if (await oauthClientExists(client.clientId)) {
      continue;
    }

    await withPendingTrustedClient(client, async () => {
      await authWithApi.api.adminCreateOAuthClient({
        body: toOAuthClientPayload(client),
      });
    });
  }
}

export async function ensureAuthHubClients(): Promise<void> {
  if (!ensuredClientsPromise) {
    ensuredClientsPromise = ensureAuthHubClientsInner().catch((error) => {
      ensuredClientsPromise = null;
      throw error;
    });
  }

  await ensuredClientsPromise;
}
