// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/profile/page`
 * Purpose: User profile settings page — display name, avatar color, and linked accounts.
 * Scope: Client component that reads/updates user profile via /api/v1/users/me. Does not handle OAuth linking flows.
 * Invariants: Requires authenticated session; avatar color updates reflected in session via update().
 * Side-effects: IO (fetch API, session update)
 * Links: src/contracts/users.profile.v1.contract.ts, src/app/api/v1/users/me/route.ts
 * @public
 */

"use client";

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/kit/data-display/Avatar";
import type {
  LinkedProvider,
  ProfileReadOutput,
} from "@/contracts/users.profile.v1.contract";

/** Preset avatar color palette */
const AVATAR_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#6b7280", // gray
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  wallet: "Ethereum Wallet",
  github: "GitHub",
  discord: "Discord",
  google: "Google",
};

const PROVIDER_ICONS: Record<string, string> = {
  wallet: "🔗",
  github: "🐙",
  discord: "💬",
  google: "🔍",
};

export default function ProfilePage() {
  const { update: updateSession } = useSession();
  const [profile, setProfile] = useState<ProfileReadOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/users/me");
      if (!res.ok) return;
      const data = (await res.json()) as ProfileReadOutput;
      setProfile(data);
      setDisplayName(data.displayName || "");
      setSelectedColor(data.avatarColor);
    } catch {
      // silently fail — page will show loading state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName || null,
          avatarColor: selectedColor,
        }),
      });
      if (res.ok) {
        await fetchProfile();
        // Refresh session so avatar updates in top bar
        await updateSession();
        setDirty(false);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <div className="text-muted-foreground">Loading profile…</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <div className="text-muted-foreground">Unable to load profile.</div>
      </div>
    );
  }

  const avatarLetter = (displayName || profile.resolvedDisplayName || "?")
    .charAt(0)
    .toUpperCase();
  const currentColor = selectedColor || "hsl(var(--primary))";

  // Find the most recently used provider
  const mostRecentProvider =
    profile.linkedProviders.reduce<LinkedProvider | null>((latest, p) => {
      if (!p.lastUsedAt) return latest;
      if (!latest?.lastUsedAt) return p;
      return new Date(p.lastUsedAt) > new Date(latest.lastUsedAt) ? p : latest;
    }, null);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="mb-8 font-semibold text-2xl text-foreground">
        Profile Settings
      </h1>

      {/* Display Name + Avatar */}
      <section className="mb-8 rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 font-medium text-foreground text-lg">
          Display Name & Avatar
        </h2>
        <div className="flex items-start gap-6">
          <Avatar
            size="lg"
            style={{ "--avatar-bg": currentColor } as React.CSSProperties}
          >
            <AvatarFallback className="bg-[var(--avatar-bg)] font-medium text-2xl text-primary-foreground">
              {avatarLetter}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col gap-3">
            <label
              htmlFor="display-name"
              className="font-medium text-foreground text-sm"
            >
              Display Name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setDirty(true);
              }}
              placeholder={profile.resolvedDisplayName}
              className="h-10 rounded-md border border-input bg-background px-3 text-foreground text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>
        </div>
      </section>

      {/* Avatar Color */}
      <section className="mb-8 rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 font-medium text-foreground text-lg">
          Avatar Color
        </h2>
        <div className="flex flex-wrap gap-3">
          {AVATAR_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => {
                setSelectedColor(color);
                setDirty(true);
              }}
              className={`h-10 w-10 rounded-full transition-all ${
                selectedColor === color
                  ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                  : "hover:scale-110"
              }`}
              style={{ backgroundColor: color }}
              aria-label={`Select color ${color}`}
            />
          ))}
        </div>
      </section>

      {/* Save button */}
      {dirty && (
        <div className="mb-8 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 font-medium text-primary-foreground text-sm shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      )}

      {/* Linked Accounts */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 font-medium text-foreground text-lg">
          Linked Accounts
        </h2>
        {profile.linkedProviders.length === 0 ? (
          <p className="text-muted-foreground text-sm">No linked accounts.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {profile.linkedProviders.map((lp) => {
              const isLastUsed =
                mostRecentProvider &&
                lp.provider === mostRecentProvider.provider;
              return (
                <div
                  key={lp.provider}
                  className={`flex items-center gap-4 rounded-lg border p-4 ${
                    isLastUsed
                      ? "border-primary/50 bg-primary/5"
                      : "border-border"
                  }`}
                >
                  <span className="text-2xl" aria-hidden="true">
                    {PROVIDER_ICONS[lp.provider] || "🔗"}
                  </span>
                  <div className="flex flex-1 flex-col">
                    <span className="font-medium text-foreground text-sm">
                      {PROVIDER_LABELS[lp.provider] || lp.provider}
                    </span>
                    {lp.providerLogin && (
                      <span className="text-muted-foreground text-xs">
                        {lp.providerLogin}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {lp.isPrimary && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
                        Primary
                      </span>
                    )}
                    {isLastUsed && (
                      <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-foreground text-xs">
                        Last used
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
