// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/profile/page`
 * Purpose: User profile settings page — display name, avatar color, and linked accounts.
 * Scope: Client component that reads/updates user profile via /api/v1/users/me; does not handle OAuth flow directly or manage session persistence.
 * Invariants: Requires authenticated session (enforced by parent layout); avatar color updates reflected in session via update().
 * Side-effects: IO (fetch API, session update, navigation for OAuth linking)
 * Links: src/contracts/users.profile.v1.contract.ts, src/app/api/v1/users/me/route.ts
 * @public
 */

"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Check } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Avatar,
  AvatarFallback,
  Button,
  DiscordIcon,
  EthereumIcon,
  GitHubIcon,
  GoogleIcon,
  PageContainer,
} from "@/components";

/* ─── Types ────────────────────────────────────────────────────────── */

interface LinkedProvider {
  provider: "wallet" | "discord" | "github" | "google";
  providerLogin: string | null;
}

interface ProfileData {
  displayName: string | null;
  avatarColor: string | null;
  resolvedDisplayName: string;
  linkedProviders: LinkedProvider[];
}

/* ─── Preset avatar color palette ─────────────────────────────────── */

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

/* ─── OAuth provider config for linked accounts ───────────────────── */

const OAUTH_PROVIDERS = [
  {
    id: "github" as const,
    label: "GitHub",
    description: "Link your GitHub account.",
    Icon: GitHubIcon,
  },
  {
    id: "discord" as const,
    label: "Discord",
    description: "Link your Discord account.",
    Icon: DiscordIcon,
  },
  {
    id: "google" as const,
    label: "Google",
    description: "Link your Google account.",
    Icon: GoogleIcon,
  },
];

/* ─── Layout primitives ───────────────────────────────────────────── */

function SectionHeading({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="pt-8 pb-2 first:pt-0">
      <h2 className="font-semibold text-foreground text-lg">{children}</h2>
      <div className="mt-2 border-border border-b" />
    </div>
  );
}

function SettingRow({
  icon,
  label,
  description,
  children,
}: {
  icon?: ReactNode;
  label: string;
  description?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <div className="flex items-center justify-between gap-4 py-5">
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <div className="flex shrink-0 items-center justify-center text-muted-foreground">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-medium text-foreground text-sm">{label}</div>
            {description && (
              <div className="text-muted-foreground text-sm">{description}</div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
      <div className="border-border border-b last:border-b-0" />
    </>
  );
}

function ConnectedBadge({ login }: { login: string }): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-sm">{login}</span>
      <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Check className="size-3" strokeWidth={3} />
      </span>
    </div>
  );
}

/* ─── Feedback banner ──────────────────────────────────────────────── */

const FEEDBACK_MESSAGES: Record<
  string,
  { text: string; variant: "success" | "error" }
> = {
  already_linked: {
    text: "That account is already linked to a different user.",
    variant: "error",
  },
  link_failed: {
    text: "Account linking failed. Please try again.",
    variant: "error",
  },
};

function FeedbackBanner({
  linkedProvider,
  error,
}: {
  linkedProvider: string | null;
  error: string | null;
}): ReactElement | null {
  if (linkedProvider) {
    return (
      <div className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-foreground text-sm">
        Successfully linked your {linkedProvider} account.
      </div>
    );
  }
  if (error) {
    const msg = FEEDBACK_MESSAGES[error];
    if (msg) {
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-foreground text-sm">
          {msg.text}
        </div>
      );
    }
  }
  return null;
}

/* ─── Color picker swatch ─────────────────────────────────────────── */

function ColorPickerSwatch({
  colors,
  selected,
  onSelect,
}: {
  colors: readonly string[];
  selected: string;
  onSelect: (color: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open, handleClickOutside]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="size-8 cursor-pointer rounded-full outline outline-2 outline-ring outline-offset-2 transition-transform hover:scale-110"
        style={{ backgroundColor: selected }}
        aria-label="Change avatar color"
      />
      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 rounded-lg border border-border bg-popover p-3 shadow-md">
          <div className="grid grid-cols-6 gap-3">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  onSelect(color);
                  setOpen(false);
                }}
                className={`size-8 cursor-pointer rounded-full transition-all ${
                  selected === color
                    ? "outline outline-2 outline-ring outline-offset-2"
                    : "hover:scale-110"
                }`}
                style={{ backgroundColor: color }}
                aria-label={`Select color ${color}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────── */

export default function ProfilePage(): ReactElement {
  const { data: session } = useSession();
  const { openConnectModal } = useConnectModal();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [selectedColor, setSelectedColor] = useState("#6366f1");
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(
    new Set()
  );

  // Read feedback query params and strip them to prevent re-display on refresh
  const linkedProvider = searchParams.get("linked");
  const error = searchParams.get("error");

  useEffect(() => {
    if (linkedProvider || error) {
      // Strip query params after reading — prevents re-display on refresh/back
      router.replace("/profile");
    }
  }, [linkedProvider, error, router]);

  // Fetch profile data + configured providers in parallel
  useEffect(() => {
    fetch("/api/v1/users/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ProfileData | null) => {
        if (data) {
          setProfile(data);
          setSelectedColor(data.avatarColor ?? "#6366f1");
        }
      })
      .catch(() => {
        // Profile fetch failed — page still renders with session data
      });

    fetch("/api/auth/providers")
      .then((res) => res.json())
      .then((providers: Record<string, { id: string }>) => {
        const ids = new Set(
          Object.keys(providers).filter((id) => id !== "credentials")
        );
        setConfiguredProviders(ids);
      })
      .catch(() => {
        // Provider fetch failed — show nothing rather than broken links
      });
  }, []);

  const walletAddress = session?.user?.walletAddress ?? null;
  const displayName =
    profile?.resolvedDisplayName ?? session?.user?.displayName ?? "User";
  const avatarLetter = displayName.charAt(0).toUpperCase();

  // Build set of linked provider IDs for quick lookup
  const linkedProviderIds = new Set(
    profile?.linkedProviders.map((p) => p.provider) ?? []
  );

  // Get provider login by provider ID
  const getProviderLogin = (providerId: string): string | null =>
    profile?.linkedProviders.find((p) => p.provider === providerId)
      ?.providerLogin ?? null;

  return (
    <PageContainer maxWidth="2xl">
      {/* Page heading */}
      <h1 className="font-semibold text-2xl text-foreground">Profile</h1>
      <div className="border-border border-b" />

      {/* Feedback banner for linking results */}
      <FeedbackBanner linkedProvider={linkedProvider} error={error} />

      {/* ── Profile section (display name + avatar color, no divider between) ── */}

      <div className="py-3">
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="font-medium text-foreground text-sm">
            Display Name
          </div>
          <div className="flex items-center gap-3">
            <Avatar
              className="size-8"
              style={{ "--avatar-bg": selectedColor } as React.CSSProperties}
            >
              <AvatarFallback className="bg-[var(--avatar-bg)] font-semibold text-primary-foreground text-sm">
                {avatarLetter}
              </AvatarFallback>
            </Avatar>
            <span className="rounded-md border border-input bg-background px-3 py-1.5 text-foreground text-sm">
              {displayName}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="font-medium text-foreground text-sm">
            Avatar Color
          </div>
          <ColorPickerSwatch
            colors={AVATAR_COLORS}
            selected={selectedColor}
            onSelect={setSelectedColor}
          />
        </div>
      </div>
      <div className="border-border border-b" />

      {/* ── Wallet section ── */}

      <SectionHeading>Wallet</SectionHeading>

      <SettingRow
        icon={<EthereumIcon className="size-5" />}
        label="Ethereum"
        {...(walletAddress
          ? {}
          : { description: "Connect wallet to enable payments." })}
      >
        {walletAddress ? (
          <ConnectedBadge
            login={`${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`}
          />
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openConnectModal?.()}
          >
            Connect
          </Button>
        )}
      </SettingRow>

      {/* ── Connected Accounts section (only if any OAuth providers configured or linked) ── */}

      {OAUTH_PROVIDERS.some(
        ({ id }) => configuredProviders.has(id) || linkedProviderIds.has(id)
      ) && <SectionHeading>Connected Accounts</SectionHeading>}

      {OAUTH_PROVIDERS.filter(
        ({ id }) => configuredProviders.has(id) || linkedProviderIds.has(id)
      ).map(({ id, label, description, Icon }) => {
        const isLinked = linkedProviderIds.has(id);
        const login = getProviderLogin(id);

        return (
          <SettingRow
            key={id}
            icon={<Icon className="size-5" />}
            label={label}
            description={description}
          >
            {isLinked && login ? (
              <ConnectedBadge login={login} />
            ) : isLinked ? (
              <ConnectedBadge login="Connected" />
            ) : (
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/auth/link/${id}`}>Link</a>
              </Button>
            )}
          </SettingRow>
        );
      })}
    </PageContainer>
  );
}
