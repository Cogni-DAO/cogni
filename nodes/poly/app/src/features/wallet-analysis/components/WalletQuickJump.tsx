// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/WalletQuickJump`
 * Purpose: Paste-any-wallet search box — one input + Go button that navigates to `/research/w/{addr}` for any valid 0x address. Inline validation via the shared `PolyAddressSchema` Zod regex.
 * Scope: Client component. Uses `useRouter` from next/navigation. Does not fetch; does not render analysis results. Navigation triggers server-side rendering at the target route.
 * Invariants:
 *   - Address regex lives in `@cogni/node-contracts` `PolyAddressSchema` — the same one the API route enforces. One source of truth.
 *   - Normalizes to lowercase before navigation (contract invariant).
 *   - Empty input: button disabled; no error shown.
 *   - Invalid: error shown, navigation blocked.
 * Side-effects: router navigation on submit.
 * Links: docs/design/wallet-analysis-components.md, packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts
 * @public
 */

"use client";

import { PolyAddressSchema } from "@cogni/node-contracts";
import { ArrowRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactElement,
  useId,
  useMemo,
  useState,
} from "react";

import { cn } from "@/shared/util/cn";

export type WalletQuickJumpProps = {
  /** Compact variant trims vertical padding for tight headers. */
  compact?: boolean | undefined;
  /** Placeholder override (defaults to a 0x example). */
  placeholder?: string | undefined;
  /** Extra className merged into the outer form wrapper. */
  className?: string | undefined;
};

const DEFAULT_PLACEHOLDER = "0x… paste any Polymarket wallet";

export function WalletQuickJump({
  compact,
  placeholder,
  className,
}: WalletQuickJumpProps): ReactElement {
  const router = useRouter();
  const inputId = useId();
  const errId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const parseResult = useMemo(
    () => (trimmed === "" ? null : PolyAddressSchema.safeParse(trimmed)),
    [trimmed]
  );
  const isValid = parseResult?.success === true;

  function submit(ev?: FormEvent): void {
    ev?.preventDefault();
    if (!parseResult) {
      setError("Paste a 0x wallet address first.");
      return;
    }
    if (!parseResult.success) {
      setError("Not a valid 0x address (expected 40 hex chars after 0x).");
      return;
    }
    setError(null);
    router.push(`/research/w/${parseResult.data}`);
  }

  return (
    <form
      onSubmit={submit}
      className={cn("flex flex-col gap-1", className)}
      aria-describedby={error ? errId : undefined}
    >
      <div
        className={cn(
          "group flex items-center gap-2 rounded-lg border bg-background",
          compact ? "px-3 py-1.5" : "px-3 py-2",
          error
            ? "border-destructive/60 focus-within:border-destructive"
            : "border-border focus-within:border-primary"
        )}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <label htmlFor={inputId} className="sr-only">
          Wallet address
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={placeholder ?? DEFAULT_PLACEHOLDER}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          className={cn(
            "flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/60",
            compact && "text-xs"
          )}
        />
        <button
          type="submit"
          disabled={trimmed === ""}
          className={cn(
            "inline-flex items-center gap-1 rounded border px-2 py-1 font-medium text-xs transition-colors",
            isValid
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
              : "border-border text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          )}
        >
          Analyze
          <ArrowRight className="size-3" aria-hidden />
        </button>
      </div>
      {error && (
        <span id={errId} className="pl-3 text-destructive text-xs" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
