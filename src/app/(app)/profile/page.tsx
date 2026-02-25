// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/profile/page`
 * Purpose: User profile settings page — display name, avatar color, wallet, and linked OAuth accounts.
 * Scope: Static scaffold (appearance only). Will be wired to /api/v1/users/me in a follow-up.
 * Invariants: Requires authenticated session (enforced by parent layout).
 * Side-effects: none (scaffold)
 * Links: src/contracts/users.profile.v1.contract.ts
 * @public
 */

"use client";

import { Check } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, Button, PageContainer } from "@/components";

/* ─── Brand SVG icons ─────────────────────────────────────────────── */

function EthereumIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 320 512"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M311.9 260.8L160 353.6 8 260.8 160 0l151.9 260.8zM160 383.4L8 290.6 160 512l152-221.4-152 92.8z" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 98 96"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
      />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 127.14 96.36"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
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
      <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <Check className="size-3" strokeWidth={3} />
      </span>
    </div>
  );
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
        className="size-8 cursor-pointer rounded-full ring-2 ring-ring ring-offset-2 ring-offset-background transition-transform hover:scale-110"
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
                    ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
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
  const [selectedColor, setSelectedColor] = useState("#6366f1");

  return (
    <PageContainer maxWidth="2xl">
      {/* Page heading */}
      <h1 className="font-semibold text-2xl text-foreground">Profile</h1>
      <div className="border-border border-b" />

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
                D
              </AvatarFallback>
            </Avatar>
            <span className="rounded-md border border-input bg-background px-3 py-1.5 text-foreground text-sm">
              derekg
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
        description="Link your Ethereum wallet for on-chain identity."
      >
        <Button variant="outline" size="sm">
          Connect
        </Button>
      </SettingRow>

      {/* ── Connected Accounts section ── */}

      <SectionHeading>Connected Accounts</SectionHeading>

      <SettingRow
        icon={<GitHubIcon className="size-5" />}
        label="GitHub"
        description="Link your GitHub account."
      >
        <ConnectedBadge login="derekg1729" />
      </SettingRow>

      <SettingRow
        icon={<DiscordIcon className="size-5" />}
        label="Discord"
        description="Link your Discord account."
      >
        <Button variant="outline" size="sm">
          Link
        </Button>
      </SettingRow>

      <SettingRow
        icon={<GoogleIcon className="size-5" />}
        label="Google"
        description="Link your Google account."
      >
        <Button variant="outline" size="sm">
          Link
        </Button>
      </SettingRow>
    </PageContainer>
  );
}
