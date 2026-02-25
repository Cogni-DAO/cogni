// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/users/profile.server`
 * Purpose: Facade for user profile read and update operations.
 * Scope: Queries/upserts user_profiles and user_bindings for the authenticated user. Does not handle HTTP transport.
 * Invariants:
 * - DISPLAY_NAME_FALLBACK: resolved_display_name applies fallback chain (profile → primary binding → any binding → wallet truncation).
 * - Uses appDb (post-authentication, user already validated by route wrapper).
 * Side-effects: IO (database reads/writes)
 * Links: src/contracts/users.profile.v1.contract.ts
 * @public
 */

import { eq } from "drizzle-orm";
import { resolveAppDb } from "@/bootstrap/container";
import type {
  ProfileReadOutput,
  ProfileUpdateInput,
  ProfileUpdateOutput,
} from "@/contracts/users.profile.v1.contract";
import type { SessionUser } from "@/shared/auth";
import { userBindings, userProfiles, users } from "@/shared/db/schema";

/** Truncate wallet address for display: 0x1234…abcd */
function truncateWallet(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Apply display-name fallback chain */
function resolveDisplayName(
  profile: { displayName: string | null } | undefined,
  bindings: Array<{
    provider: string;
    providerLogin: string | null;
    isPrimary: boolean;
  }>,
  walletAddress: string | null
): string {
  if (profile?.displayName) return profile.displayName;

  const primary = bindings.find((b) => b.isPrimary);
  if (primary?.providerLogin) return primary.providerLogin;

  const anyLogin = bindings.find((b) => b.providerLogin);
  if (anyLogin?.providerLogin) return anyLogin.providerLogin;

  if (walletAddress) return truncateWallet(walletAddress);

  return "Anonymous";
}

export async function readProfile(
  sessionUser: SessionUser
): Promise<ProfileReadOutput> {
  const db = resolveAppDb();

  const [profile, bindings, user] = await Promise.all([
    db.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, sessionUser.id),
    }),
    db
      .select({
        provider: userBindings.provider,
        providerLogin: userBindings.providerLogin,
        providerAvatarUrl: userBindings.providerAvatarUrl,
        isPrimary: userBindings.isPrimary,
        lastUsedAt: userBindings.lastUsedAt,
      })
      .from(userBindings)
      .where(eq(userBindings.userId, sessionUser.id)),
    db.query.users.findFirst({
      where: eq(users.id, sessionUser.id),
      columns: { walletAddress: true },
    }),
  ]);

  const resolvedDisplayName = resolveDisplayName(
    profile,
    bindings,
    user?.walletAddress ?? sessionUser.walletAddress
  );

  return {
    displayName: profile?.displayName ?? null,
    avatarColor: profile?.avatarColor ?? null,
    resolvedDisplayName,
    linkedProviders: bindings.map((b) => ({
      provider: b.provider as "wallet" | "discord" | "github" | "google",
      providerLogin: b.providerLogin,
      providerAvatarUrl: b.providerAvatarUrl,
      isPrimary: b.isPrimary,
      lastUsedAt: b.lastUsedAt?.toISOString() ?? null,
    })),
  };
}

export async function updateProfile(
  sessionUser: SessionUser,
  input: ProfileUpdateInput
): Promise<ProfileUpdateOutput> {
  const db = resolveAppDb();
  const { displayName, avatarColor } = input;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (displayName !== undefined) updates.displayName = displayName;
  if (avatarColor !== undefined) updates.avatarColor = avatarColor;

  await db
    .insert(userProfiles)
    .values({
      userId: sessionUser.id,
      displayName: displayName ?? null,
      avatarColor: avatarColor ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: updates,
    });

  // Re-read for response
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, sessionUser.id),
  });

  const bindings = await db
    .select({
      provider: userBindings.provider,
      providerLogin: userBindings.providerLogin,
      isPrimary: userBindings.isPrimary,
    })
    .from(userBindings)
    .where(eq(userBindings.userId, sessionUser.id));

  const user = await db.query.users.findFirst({
    where: eq(users.id, sessionUser.id),
    columns: { walletAddress: true },
  });

  const resolvedDisplayName = resolveDisplayName(
    profile,
    bindings,
    user?.walletAddress ?? sessionUser.walletAddress
  );

  return {
    displayName: profile?.displayName ?? null,
    avatarColor: profile?.avatarColor ?? null,
    resolvedDisplayName,
  };
}
