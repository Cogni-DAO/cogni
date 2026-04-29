// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/wallet/PolicyControls`
 * Purpose: Reusable two-row policy editor surfacing `polyWalletGrants.{per_order_usdc_cap, daily_usdc_cap}`. Editable variant lives on the Money page; readonly variant lives on each Research wallet detail with an `Edit on Money →` link.
 * Scope: Pure presentational client component. Owns its own draft state in editable mode and validation. Does NOT fetch or mutate — caller wires React Query and passes `onSave` returning a Promise that may reject with `{code: "invalid_caps"}`.
 * Invariants: SAME_COMPONENT_BOTH_PLACES — Money page and per-target view mount this exact file; no divergent layouts. NUMERIC_VALIDATION — both values are positive numbers and `daily >= per_order` enforced before `onSave`. NO_NEW_TOKENS — only existing kit primitives + Tailwind utility classes.
 * Side-effects: none (component-local state only).
 * Notes: Two affordances total — `edit` link top-right when `!readonly`, `Edit on Money →` link below the row when `readonly`. Inputs use `inputMode="decimal"` not `type="number"` so the number-spinner UI doesn't appear.
 * Links: work/items/task.0347.poly-wallet-preferences-sizing-config.md, nodes/poly/packages/node-contracts/src/poly.wallet.grants.v1.contract.ts
 * @public
 */

"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components";
import { cn } from "@/shared/util/cn";

export interface PolicyValues {
  per_order_usdc_cap: number;
  daily_usdc_cap: number;
}

export interface PolicyControlsProps {
  values: PolicyValues;
  onSave?: (next: PolicyValues) => Promise<void>;
  readonly?: boolean;
  className?: string;
}

function fmtUsdc(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PolicyControls({
  values,
  onSave,
  readonly,
  className,
}: PolicyControlsProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draftPerOrder, setDraftPerOrder] = useState(
    values.per_order_usdc_cap.toFixed(2)
  );
  const [draftDaily, setDraftDaily] = useState(
    values.daily_usdc_cap.toFixed(2)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraftPerOrder(values.per_order_usdc_cap.toFixed(2));
    setDraftDaily(values.daily_usdc_cap.toFixed(2));
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function handleSave() {
    const perOrder = Number.parseFloat(draftPerOrder);
    const daily = Number.parseFloat(draftDaily);
    if (!Number.isFinite(perOrder) || perOrder <= 0) {
      setError("Per trade must be greater than 0");
      return;
    }
    if (!Number.isFinite(daily) || daily <= 0) {
      setError("Per day must be greater than 0");
      return;
    }
    if (daily < perOrder) {
      setError("Per day must be at least Per trade");
      return;
    }
    if (!onSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ per_order_usdc_cap: perOrder, daily_usdc_cap: daily });
      setEditing(false);
    } catch (err) {
      const code =
        typeof err === "object" && err && "code" in err
          ? (err as { code?: unknown }).code
          : null;
      setError(
        code === "invalid_caps"
          ? "Per day must be at least Per trade"
          : "Save failed — try again"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
          Policy
        </span>
        {!readonly && !editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="font-mono text-muted-foreground text-xs uppercase tracking-wide transition-colors hover:text-foreground"
          >
            edit
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <PolicyEditCell
              id="policy-per-order"
              label="Per trade"
              value={draftPerOrder}
              onChange={setDraftPerOrder}
              disabled={saving}
            />
            <PolicyEditCell
              id="policy-daily"
              label="Per day"
              value={draftDaily}
              onChange={setDraftDaily}
              disabled={saving}
            />
          </div>
          <div className="flex items-center justify-end gap-3">
            {error ? (
              <span className="mr-auto text-destructive text-xs">{error}</span>
            ) : null}
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="font-mono text-muted-foreground text-xs uppercase tracking-wide transition-colors hover:text-foreground disabled:opacity-50"
            >
              cancel
            </button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <PolicyValueCell
              label="Per trade"
              value={`$${fmtUsdc(values.per_order_usdc_cap)}`}
            />
            <PolicyValueCell
              label="Per day"
              value={`$${fmtUsdc(values.daily_usdc_cap)}`}
            />
          </div>
          {readonly ? (
            <Link
              href="/credits"
              className="self-start font-mono text-muted-foreground text-xs uppercase tracking-wide transition-colors hover:text-foreground"
            >
              Edit on Money →
            </Link>
          ) : null}
        </>
      )}
    </div>
  );
}

function PolicyValueCell({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="font-semibold text-base tabular-nums tracking-tight">
        {value}
      </div>
    </div>
  );
}

function PolicyEditCell({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted/40 px-3 py-2">
      <label
        htmlFor={id}
        className="text-muted-foreground text-xs uppercase tracking-wide"
      >
        {label}
      </label>
      <span className="flex items-baseline gap-1">
        <span className="font-semibold text-base text-muted-foreground">$</span>
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full bg-transparent font-semibold text-base tabular-nums tracking-tight outline-none disabled:opacity-50"
        />
      </span>
    </div>
  );
}
