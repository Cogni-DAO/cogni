// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/wallet-format`
 * Purpose: Shared display formatters for Polymarket wallet/order dashboard cards.
 * Scope: Pure string/number → string helpers. No I/O. No business logic.
 * Invariants: No side effects. Stable outputs for given inputs.
 * Side-effects: none
 * @public
 */

export { formatShortWallet } from "@/components/kit/wallet";

export function formatUsdc(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatPnl(n: number): string {
  const prefix = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${prefix}$${(abs / 1_000).toFixed(1)}K`;
  return `${prefix}$${abs.toFixed(2)}`;
}

export function formatRoi(roiPct: number | null): string {
  if (roiPct === null) return "—";
  const sign = roiPct > 0 ? "+" : "";
  return `${sign}${roiPct.toFixed(1)}%`;
}

export function formatNumTrades(n: number, capped: boolean): string {
  if (n === 0) return "0";
  return capped ? `${n}+` : String(n);
}

export function formatPrice(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "—";
  return p.toFixed(3);
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
