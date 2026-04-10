// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@/auth`
 * Purpose: NextAuth.js configuration and export.
 * Scope: App-wide authentication configuration. Does not handle client-side session management.
 * Invariants: SIWE + OAuth resolve to canonical user_id via user_bindings ; NO_AUTO_MERGE enforced on link-intent conflicts ; atomic new-user tx (user + binding + event)
 * Side-effects: IO
 * Notes: Handles session creation, validation, and persistence.
 * Links: docs/spec/authentication.md
 * @public
 */

/* eslint-disable boundaries/no-unknown-files */

import nodeCrypto, { randomUUID } from "node:crypto";
import type { Database } from "@cogni/db-client";
import {
  AnalyticsEvents,
  AUTH_HUB_GITHUB_ID_CLAIM,
  AUTH_HUB_GITHUB_LOGIN_CLAIM,
  authHubClaimsSchema,
  capture,
  isFailedIntent,
  isPendingIntent,
  linkIntentStore,
} from "@cogni/node-shared";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Account, NextAuthOptions, Profile } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Discord from "next-auth/providers/discord";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import type { OAuthConfig } from "next-auth/providers/oauth";
import { getCsrfToken } from "next-auth/react";
import { SiweMessage } from "siwe";
import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { createBinding } from "@/adapters/server/identity/create-binding";
import {
  aiThreads,
  billingAccounts,
  connections,
  epochSelection,
  epochUserProjections,
  executionGrants,
  graphRuns,
  identityEvents,
  linkTransactions,
  schedules,
  userBindings,
  userProfiles,
  users,
} from "@/shared/db/schema";
import { makeLogger } from "@/shared/observability";

export const authSecret =
  process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";

// Lazy logger initialization to avoid module-level env validation
const getLog = () => makeLogger({ module: "auth" });

const LINK_INTENT_TTL = 5 * 60; // 5 minutes — must match route.ts
const AUTH_HUB_SCOPE = "openid profile email offline_access";
const KNOWN_OAUTH = new Set(["github", "discord", "google"]);
const AUTH_HUB_REKEY_TARGET_EXISTS = "AUTH_HUB_REKEY_TARGET_EXISTS";
const AUTH_HUB_REKEY_SOURCE_MISSING = "AUTH_HUB_REKEY_SOURCE_MISSING";

interface OAuthIdentity {
  readonly provider: "github" | "discord" | "google";
  readonly externalId: string;
  readonly providerLogin: string | null;
  readonly canonicalUserId: string | null;
  readonly name: string | null;
  readonly email: string | null;
  readonly image: string | null;
}

function hasAuthHubGitHubConfig(): boolean {
  return Boolean(
    process.env.AUTH_HUB_ISSUER &&
      process.env.AUTH_HUB_CLIENT_ID &&
      process.env.AUTH_HUB_CLIENT_SECRET
  );
}

function buildAuthHubGitHubProvider(): OAuthConfig<Record<string, unknown>> {
  const issuer = process.env.AUTH_HUB_ISSUER;
  const clientId = process.env.AUTH_HUB_CLIENT_ID;
  const clientSecret = process.env.AUTH_HUB_CLIENT_SECRET;

  if (!issuer || !clientId || !clientSecret) {
    throw new Error("AUTH_HUB_GITHUB_NOT_CONFIGURED");
  }

  return {
    id: "github",
    name: "GitHub",
    type: "oauth",
    wellKnown: `${issuer}/.well-known/openid-configuration`,
    issuer,
    clientId,
    clientSecret,
    authorization: {
      params: {
        scope: AUTH_HUB_SCOPE,
      },
    },
    checks: ["pkce", "state", "nonce"],
    idToken: true,
    profile(profile) {
      const claims = authHubClaimsSchema.parse(profile);

      return {
        id: claims.sub,
        name: claims.name ?? claims[AUTH_HUB_GITHUB_LOGIN_CLAIM],
        email: claims.email ?? null,
        ...(claims.picture ? { image: claims.picture } : {}),
      };
    },
  };
}

function resolveOAuthIdentity(
  account: Account,
  profile: Profile | undefined
): OAuthIdentity | null {
  const profileData = profile as Record<string, unknown> | undefined;

  if (account.provider === "github" && hasAuthHubGitHubConfig()) {
    const parsedClaims = authHubClaimsSchema.safeParse(profileData ?? {});
    if (!parsedClaims.success) {
      getLog().warn(
        { issues: parsedClaims.error.issues },
        "[OAuth] Auth hub claims were malformed"
      );
      return null;
    }

    const claims = parsedClaims.data;
    return {
      provider: "github",
      externalId: claims[AUTH_HUB_GITHUB_ID_CLAIM],
      providerLogin: claims[AUTH_HUB_GITHUB_LOGIN_CLAIM],
      canonicalUserId: claims.sub,
      name: claims.name ?? claims[AUTH_HUB_GITHUB_LOGIN_CLAIM],
      email: claims.email ?? null,
      image: claims.picture ?? null,
    };
  }

  return {
    provider: account.provider as OAuthIdentity["provider"],
    externalId: account.providerAccountId,
    providerLogin:
      (profileData?.login as string | undefined) ??
      (profileData?.username as string | undefined) ??
      null,
    canonicalUserId: null,
    name: (profileData?.name as string | null | undefined) ?? null,
    email: (profileData?.email as string | null | undefined) ?? null,
    image:
      (profileData?.avatar_url as string | null | undefined) ??
      (profileData?.picture as string | null | undefined) ??
      null,
  };
}

function buildHubUserPatch(identity: OAuthIdentity): {
  name?: string | null;
  email?: string | null;
  image?: string | null;
} {
  const update: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } = {};

  if (identity.name !== null) {
    update.name = identity.name;
  }
  if (identity.email !== null) {
    update.email = identity.email;
  }
  if (identity.image !== null) {
    update.image = identity.image;
  }

  return update;
}

async function rekeyLocalUserToHubSubject(
  db: Database,
  fromUserId: string,
  toUserId: string,
  identity: OAuthIdentity
): Promise<void> {
  if (fromUserId === toUserId) {
    return;
  }

  const sourceUser = await db.query.users.findFirst({
    where: eq(users.id, fromUserId),
  });
  if (!sourceUser) {
    throw new Error(AUTH_HUB_REKEY_SOURCE_MISSING);
  }

  const existingTargetUser = await db.query.users.findFirst({
    where: eq(users.id, toUserId),
  });
  if (existingTargetUser) {
    throw new Error(AUTH_HUB_REKEY_TARGET_EXISTS);
  }

  const mergeEventId = randomUUID();

  await db.transaction(async (tx) => {
    if (sourceUser.walletAddress) {
      await tx
        .update(users)
        .set({ walletAddress: null })
        .where(eq(users.id, fromUserId));
    }

    await tx.insert(users).values({
      id: toUserId,
      name: identity.name ?? sourceUser.name,
      email: identity.email ?? sourceUser.email,
      emailVerified: sourceUser.emailVerified,
      image: identity.image ?? sourceUser.image,
      walletAddress: sourceUser.walletAddress,
    });

    await tx
      .update(billingAccounts)
      .set({ ownerUserId: toUserId })
      .where(eq(billingAccounts.ownerUserId, fromUserId));
    await tx
      .update(userProfiles)
      .set({ userId: toUserId })
      .where(eq(userProfiles.userId, fromUserId));
    await tx
      .update(userBindings)
      .set({ userId: toUserId })
      .where(eq(userBindings.userId, fromUserId));
    await tx
      .update(linkTransactions)
      .set({ userId: toUserId })
      .where(eq(linkTransactions.userId, fromUserId));
    await tx
      .update(identityEvents)
      .set({ userId: toUserId })
      .where(eq(identityEvents.userId, fromUserId));
    await tx
      .update(executionGrants)
      .set({ userId: toUserId })
      .where(eq(executionGrants.userId, fromUserId));
    await tx
      .update(schedules)
      .set({ ownerUserId: toUserId })
      .where(eq(schedules.ownerUserId, fromUserId));
    await tx
      .update(epochSelection)
      .set({ userId: toUserId })
      .where(eq(epochSelection.userId, fromUserId));
    await tx
      .update(epochUserProjections)
      .set({ userId: toUserId })
      .where(eq(epochUserProjections.userId, fromUserId));
    await tx
      .update(connections)
      .set({ createdByUserId: toUserId })
      .where(eq(connections.createdByUserId, fromUserId));
    await tx
      .update(connections)
      .set({ revokedByUserId: toUserId })
      .where(eq(connections.revokedByUserId, fromUserId));
    await tx
      .update(aiThreads)
      .set({ ownerUserId: toUserId })
      .where(eq(aiThreads.ownerUserId, fromUserId));
    await tx
      .update(graphRuns)
      .set({ requestedBy: toUserId })
      .where(eq(graphRuns.requestedBy, fromUserId));

    await tx.insert(identityEvents).values({
      id: mergeEventId,
      userId: toUserId,
      eventType: "merge",
      payload: {
        from_user_id: fromUserId,
        to_user_id: toUserId,
        provider: "github",
        external_id: identity.externalId,
        method: "auth_hub_rekey",
      },
    });

    await tx.delete(users).where(eq(users.id, fromUserId));
    await tx
      .insert(userProfiles)
      .values({ userId: toUserId })
      .onConflictDoNothing();
  });
}

async function syncHubGithubProjection(
  db: Database,
  userId: string,
  identity: OAuthIdentity
): Promise<void> {
  const existingBinding = await db.query.userBindings.findFirst({
    where: and(
      eq(userBindings.provider, "github"),
      eq(userBindings.externalId, identity.externalId)
    ),
  });

  if (!existingBinding) {
    await createBinding(db, userId, "github", identity.externalId, {
      method: "oauth_hub",
      hub_sub: identity.canonicalUserId,
      login: identity.providerLogin,
      name: identity.name,
    });
  } else if (existingBinding.userId !== userId) {
    throw new Error(AUTH_HUB_REKEY_TARGET_EXISTS);
  }

  if (identity.providerLogin) {
    await db
      .update(userBindings)
      .set({ providerLogin: identity.providerLogin })
      .where(
        and(
          eq(userBindings.provider, "github"),
          eq(userBindings.externalId, identity.externalId)
        )
      );
  }

  const userPatch = buildHubUserPatch(identity);
  if (Object.keys(userPatch).length > 0) {
    await db.update(users).set(userPatch).where(eq(users.id, userId));
  }

  await db.insert(userProfiles).values({ userId }).onConflictDoNothing();
}

/**
 * Create a link transaction row in the DB. Called by the link initiation route
 * to establish DB-backed authority for the linking flow.
 * Returns the transaction ID for inclusion in the JWT cookie.
 */
export async function createLinkTransaction(
  userId: string,
  provider: string
): Promise<string> {
  const db = getServiceDb();
  const txId = randomUUID();
  const expiresAt = new Date(Date.now() + LINK_INTENT_TTL * 1000);
  await db.insert(linkTransactions).values({
    id: txId,
    userId,
    provider,
    expiresAt,
  });
  return txId;
}

/**
 * Atomically consume a link transaction. Returns the userId if the transaction
 * is valid (exists, not consumed, not expired, matches provider), or null if not.
 * Single UPDATE with all conditions — no separate SELECT needed.
 */
async function consumeLinkTransaction(
  txId: string,
  userId: string,
  provider: string
): Promise<string | null> {
  const db = getServiceDb();
  const [consumed] = await db
    .update(linkTransactions)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(linkTransactions.id, txId),
        eq(linkTransactions.userId, userId),
        eq(linkTransactions.provider, provider),
        isNull(linkTransactions.consumedAt),
        gt(linkTransactions.expiresAt, new Date())
      )
    )
    .returning();
  return consumed?.userId ?? null;
}

/**
 * NextAuth configuration.
 * Exports authOptions for use in route handlers and server helpers.
 *
 * Note: No adapter with JWT strategy. Credentials provider manually manages users table.
 * Database sessions table is not used; JWT tokens stored in HttpOnly cookies instead.
 */
export const authOptions: NextAuthOptions = {
  pages: {
    // Prevent redirect to default NextAuth sign-in page
    signIn: "/",
  },
  session: {
    strategy: "jwt",
    // 30 days
    maxAge: 30 * 24 * 60 * 60,
  },
  secret: authSecret,
  // Rely on AUTH_SECRET or NEXTAUTH_SECRET in process.env
  providers: [
    Credentials({
      // Changed from "siwe" to match default RainbowKit adapter expectation
      id: "credentials",
      name: "Sign-In with Ethereum",
      credentials: {
        message: { label: "Message", type: "text" },
        signature: { label: "Signature", type: "text" },
      },
      async authorize(credentials, req) {
        try {
          if (!credentials?.message || !credentials?.signature) {
            getLog().error("[SIWE] Missing credentials");
            return null;
          }

          const siwe = new SiweMessage(credentials.message as string);
          const nextAuthUrl = new URL(
            process.env.NEXTAUTH_URL ?? "http://localhost:3000"
          );

          // Convert Headers to plain object for getCsrfToken
          const headers: Record<string, string> = {};
          if (req.headers instanceof Headers) {
            for (const [key, value] of req.headers.entries()) {
              headers[key] = value;
            }
          } else {
            Object.assign(headers, req.headers);
          }

          // Verify domain, nonce, and signature
          const nonce = await getCsrfToken({ req: { headers } });
          if (!nonce) {
            getLog().error("[SIWE] Failed to retrieve nonce");
            return null;
          }

          // [DEBUG] Log attempt details
          const messageHash = nodeCrypto
            .createHash("sha256")
            .update(credentials.message as string)
            .digest("hex")
            .slice(0, 8);
          getLog().info(
            {
              nonce,
              address: new SiweMessage(credentials.message as string).address,
              msgHash: messageHash,
            },
            "[SIWE] Authorize attempt"
          );

          const result = await siwe.verify({
            signature: credentials.signature as string,
            domain: nextAuthUrl.host,
            nonce,
          });

          if (!result.success) {
            getLog().error(
              { error: result.error },
              "[SIWE] Verification failed"
            );
            return null;
          }

          const { data: fields } = result;
          // Pre-auth wallet lookup must use serviceDb (BYPASSRLS) because
          // the user ID is unknown before authentication completes.
          // Per DATABASE_RLS_SPEC.md: SIWE auth callback uses app_service role.
          const db = getServiceDb();

          // Check for existing user
          const existingUser = await db.query.users.findFirst({
            where: eq(users.walletAddress, fields.address),
          });
          let user = existingUser;

          if (!user) {
            // Create new user if not exists
            const newUserId = randomUUID();
            const [newUser] = await db
              .insert(users)
              .values({
                id: newUserId,
                walletAddress: fields.address,
              })
              .returning();
            user = newUser;

            // Create empty profile row for new user
            if (user) {
              try {
                await db
                  .insert(userProfiles)
                  .values({ userId: user.id })
                  .onConflictDoNothing();
              } catch {
                getLog().warn(
                  { userId: user.id },
                  "[SIWE] Profile row creation failed — non-critical"
                );
              }
            }
          }

          if (!user) {
            getLog().error("[SIWE] Failed to create or retrieve user");
            return null;
          }

          // Record wallet binding (idempotent — skips if already bound).
          // Failure must not block login — binding is supplementary, not auth-critical.
          try {
            await createBinding(db, user.id, "wallet", fields.address, {
              method: "siwe",
              domain: nextAuthUrl.host,
            });
          } catch (bindingError) {
            getLog().warn(
              { error: bindingError, address: fields.address },
              "[SIWE] Binding insert failed — login continues"
            );
          }

          getLog().info({ address: fields.address }, "[SIWE] Login success");

          capture({
            event: AnalyticsEvents.AUTH_SIGNED_IN,
            identity: { userId: user.id, sessionId: randomUUID() },
            properties: { provider: "wallet", is_new_user: !existingUser },
          });

          // Always use DB UUID as primary ID
          return {
            id: user.id,
            walletAddress: fields.address,
          };
        } catch (e) {
          getLog().error({ error: e }, "[SIWE] Authorize error");
          return null;
        }
      },
    }),
    // Only register OAuth providers when credentials are configured
    ...(hasAuthHubGitHubConfig()
      ? [buildAuthHubGitHubProvider()]
      : process.env.GH_OAUTH_CLIENT_ID && process.env.GH_OAUTH_CLIENT_SECRET
        ? [
            GitHub({
              clientId: process.env.GH_OAUTH_CLIENT_ID,
              clientSecret: process.env.GH_OAUTH_CLIENT_SECRET,
            }),
          ]
        : []),
    ...(process.env.DISCORD_OAUTH_CLIENT_ID &&
    process.env.DISCORD_OAUTH_CLIENT_SECRET
      ? [
          Discord({
            clientId: process.env.DISCORD_OAUTH_CLIENT_ID,
            clientSecret: process.env.DISCORD_OAUTH_CLIENT_SECRET,
          }),
        ]
      : []),
    ...(process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
            clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // SIWE (Credentials) flow: user already resolved in authorize(), pass through
      if (!account || account.provider === "credentials") return true;

      // Only handle known OAuth providers
      if (!KNOWN_OAUTH.has(account.provider)) return false;

      const db = getServiceDb();
      const oauthIdentity = resolveOAuthIdentity(account, profile);
      if (!oauthIdentity) {
        return false;
      }

      const provider = oauthIdentity.provider;
      const externalId = oauthIdentity.externalId;

      // Check for link intent BEFORE returning-user shortcut.
      // If a link intent is active, the caller is trying to bind this external
      // account to their existing user — we must NOT silently log them in as
      // the binding owner if it's a different user.
      const linkIntent = linkIntentStore.getStore();

      // Fail-closed: if the link transaction could not be verified, reject immediately.
      // This prevents silent fall-through to new-user creation when the cookie was
      // lost, expired, tampered, or already consumed.
      if (isFailedIntent(linkIntent)) {
        getLog().warn(
          { provider, reason: linkIntent.reason },
          "[OAuth] Link intent rejected — fail-closed"
        );
        return "/profile?error=link_failed";
      }

      // Pending intent: atomically consume the DB transaction to verify it.
      // If consumption fails, reject — never fall through to new-user creation.
      let verifiedUserId: string | null = null;
      if (isPendingIntent(linkIntent)) {
        verifiedUserId = await consumeLinkTransaction(
          linkIntent.txId,
          linkIntent.userId,
          provider
        );
        if (!verifiedUserId) {
          getLog().warn(
            { provider, txId: linkIntent.txId },
            "[OAuth] Link tx consume failed — expired/consumed/mismatched"
          );
          return "/profile?error=link_failed";
        }
      }

      let existing = await db.query.userBindings.findFirst({
        where: and(
          eq(userBindings.provider, provider),
          eq(userBindings.externalId, externalId)
        ),
      });

      if (provider === "github" && oauthIdentity.canonicalUserId) {
        const canonicalUserId = oauthIdentity.canonicalUserId;
        const wasLinkingExistingUser =
          verifiedUserId !== null && verifiedUserId !== canonicalUserId;

        if (
          verifiedUserId &&
          existing &&
          existing.userId !== verifiedUserId &&
          existing.userId !== canonicalUserId
        ) {
          getLog().warn(
            {
              externalId,
              provider,
              verifiedUserId,
              bindingUserId: existing.userId,
            },
            "[OAuth] Link rejected — GitHub identity already belongs to another local user"
          );
          return "/profile?error=already_linked";
        }

        if (existing && existing.userId !== canonicalUserId) {
          try {
            await rekeyLocalUserToHubSubject(
              db,
              existing.userId,
              canonicalUserId,
              oauthIdentity
            );
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === AUTH_HUB_REKEY_TARGET_EXISTS
            ) {
              getLog().warn(
                {
                  externalId,
                  provider,
                  legacyUserId: existing.userId,
                  canonicalUserId,
                },
                "[OAuth] Hub rekey blocked — canonical target user already exists"
              );
              return verifiedUserId ? "/profile?error=already_linked" : false;
            }
            throw error;
          }

          if (verifiedUserId === existing.userId) {
            verifiedUserId = canonicalUserId;
          }

          existing = await db.query.userBindings.findFirst({
            where: and(
              eq(userBindings.provider, provider),
              eq(userBindings.externalId, externalId)
            ),
          });
        }

        if (verifiedUserId && verifiedUserId !== canonicalUserId) {
          const canonicalUser = await db.query.users.findFirst({
            where: eq(users.id, canonicalUserId),
          });
          if (canonicalUser) {
            getLog().warn(
              { canonicalUserId, provider, verifiedUserId },
              "[OAuth] Link rejected — auth hub identity already resolves to a different canonical user"
            );
            return "/profile?error=already_linked";
          }

          await rekeyLocalUserToHubSubject(
            db,
            verifiedUserId,
            canonicalUserId,
            oauthIdentity
          );
          verifiedUserId = canonicalUserId;
        }

        let canonicalUser = await db.query.users.findFirst({
          where: eq(users.id, canonicalUserId),
        });
        const isNewUser = !canonicalUser && !wasLinkingExistingUser;

        if (!canonicalUser) {
          await db
            .insert(users)
            .values({
              id: canonicalUserId,
              name: oauthIdentity.name,
              email: oauthIdentity.email,
              image: oauthIdentity.image,
              walletAddress: null,
            })
            .onConflictDoNothing();

          canonicalUser = await db.query.users.findFirst({
            where: eq(users.id, canonicalUserId),
          });
        }

        await syncHubGithubProjection(db, canonicalUserId, oauthIdentity);

        canonicalUser = await db.query.users.findFirst({
          where: eq(users.id, canonicalUserId),
        });
        if (!canonicalUser) {
          getLog().error(
            { canonicalUserId, provider },
            "[OAuth] Canonical auth hub user missing after sync"
          );
          return false;
        }

        user.id = canonicalUserId;
        (user as { walletAddress?: string | null }).walletAddress =
          canonicalUser.walletAddress ?? null;

        if (verifiedUserId) {
          getLog().info(
            { provider, userId: canonicalUserId },
            "[OAuth] Auth hub GitHub account linked"
          );
          capture({
            event: AnalyticsEvents.IDENTITY_PROVIDER_LINKED,
            identity: { userId: canonicalUserId, sessionId: randomUUID() },
            properties: { provider },
          });
          return true;
        }

        capture({
          event: AnalyticsEvents.AUTH_SIGNED_IN,
          identity: { userId: canonicalUserId, sessionId: randomUUID() },
          properties: { provider, is_new_user: isNewUser },
        });
        return true;
      }

      const profileData = profile as Record<string, unknown> | undefined;
      const oauthLogin = oauthIdentity.providerLogin;

      if (existing) {
        // Update provider login on existing binding
        if (oauthLogin) {
          try {
            await db
              .update(userBindings)
              .set({ providerLogin: oauthLogin })
              .where(eq(userBindings.id, existing.id));
          } catch {
            // Non-critical metadata update
          }
        }

        if (verifiedUserId) {
          if (existing.userId === verifiedUserId) {
            // Idempotent — already linked to this user
            user.id = verifiedUserId;
            return true;
          }
          // Different user owns this binding — NO_AUTO_MERGE
          getLog().warn(
            { provider, externalId },
            "[OAuth] Link rejected — binding owned by different user"
          );
          return "/profile?error=already_linked";
        }
        // Returning user (no link intent) — set user.id so jwt callback picks it up
        user.id = existing.userId;
        capture({
          event: AnalyticsEvents.AUTH_SIGNED_IN,
          identity: { userId: existing.userId, sessionId: randomUUID() },
          properties: { provider, is_new_user: false },
        });
        return true;
      }

      if (verifiedUserId) {
        await createBinding(db, verifiedUserId, provider, externalId, {
          method: "oauth_link",
          login: profileData?.login ?? profileData?.username ?? null,
          name: profileData?.name ?? null,
        });

        user.id = verifiedUserId;
        // Preserve walletAddress in the session
        const existingUser = await db.query.users.findFirst({
          where: eq(users.id, verifiedUserId),
        });
        (user as { walletAddress?: string | null }).walletAddress =
          existingUser?.walletAddress ?? null;
        getLog().info(
          { provider, userId: verifiedUserId },
          "[OAuth] Account linked"
        );
        capture({
          event: AnalyticsEvents.IDENTITY_PROVIDER_LINKED,
          identity: { userId: verifiedUserId, sessionId: randomUUID() },
          properties: { provider },
        });
        return true;
      }

      // New user — single transaction (user + binding + profile + event atomically).
      // If the binding insert is skipped (concurrent first-login race), the
      // transaction rolls back so no orphaned user row is committed.
      const BINDING_RACE = "BINDING_RACE";
      const userId = randomUUID();
      const bindingId = randomUUID();
      const eventId = randomUUID();

      try {
        await db.transaction(async (tx) => {
          await tx.insert(users).values({
            id: userId,
            name: (profileData?.name as string | null | undefined) ?? null,
            walletAddress: null,
          });
          const [inserted] = await tx
            .insert(userBindings)
            .values({
              id: bindingId,
              userId,
              provider,
              externalId,
              providerLogin: oauthLogin,
            })
            .onConflictDoNothing({
              target: [userBindings.provider, userBindings.externalId],
            })
            .returning({ id: userBindings.id });
          if (!inserted) {
            // Another request won the race — roll back (no orphaned user)
            throw new Error(BINDING_RACE);
          }
          await tx.insert(identityEvents).values({
            id: eventId,
            userId,
            eventType: "bind",
            payload: {
              provider,
              external_id: externalId,
              method: "oauth",
              login: oauthLogin,
            },
          });
          // Create empty profile row
          await tx
            .insert(userProfiles)
            .values({ userId })
            .onConflictDoNothing();
        });
      } catch (txError) {
        if (!(txError instanceof Error) || txError.message !== BINDING_RACE) {
          throw txError;
        }
        // Race lost — re-fetch the winning binding and use that user
        const winner = await db.query.userBindings.findFirst({
          where: and(
            eq(userBindings.provider, provider),
            eq(userBindings.externalId, externalId)
          ),
        });
        if (winner) {
          user.id = winner.userId;
          (user as { walletAddress?: string | null }).walletAddress = null;
          getLog().info(
            { provider, externalId },
            "[OAuth] Race resolved — using existing user"
          );
          return true;
        }
        getLog().error(
          { provider, externalId },
          "[OAuth] Binding race: no winner found"
        );
        return false;
      }

      user.id = userId;
      (user as { walletAddress?: string | null }).walletAddress = null;
      getLog().info({ provider, externalId }, "[OAuth] New user created");
      capture({
        event: AnalyticsEvents.AUTH_SIGNED_IN,
        identity: { userId, sessionId: randomUUID() },
        properties: { provider, is_new_user: true },
      });
      return true;
    },
    /** Redirect authenticated users to /chat instead of landing on homepage */
    redirect({ url, baseUrl }) {
      // Default post-sign-in lands on "/"; send to /chat instead
      if (url === baseUrl || url === `${baseUrl}/`) {
        return `${baseUrl}/chat`;
      }
      // Allow relative URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Allow same-origin URLs
      if (url.startsWith(baseUrl)) return url;
      return baseUrl;
    },
    async jwt({ token, user, trigger }) {
      // ALWAYS explicitly set — NextAuth does not auto-forward custom fields
      if (user) {
        token.id = user.id;
        token.walletAddress =
          (user as { walletAddress?: string | null }).walletAddress ?? null;
      }

      // Load profile into token on initial sign-in or explicit update()
      if (user || trigger === "update") {
        try {
          const db = getServiceDb();
          const userId = (token.id as string) ?? user?.id;
          if (userId) {
            const profile = await db.query.userProfiles.findFirst({
              where: eq(userProfiles.userId, userId),
            });
            token.displayName = profile?.displayName ?? null;
            token.avatarColor = profile?.avatarColor ?? null;
          }
        } catch {
          // Non-critical — profile fields stay null
        }
      }
      return token;
    },
    async session({ session, token }) {
      // ALWAYS explicitly set — NextAuth does not auto-forward custom fields
      if (session.user) {
        session.user.id = token.id as string;
        session.user.walletAddress =
          (token.walletAddress as string | null) ?? null;
        session.user.displayName = (token.displayName as string | null) ?? null;
        session.user.avatarColor = (token.avatarColor as string | null) ?? null;
      }
      return session;
    },
  },
  // Enable debugging to diagnose login issues
  debug: process.env.NODE_ENV === "development",
};
