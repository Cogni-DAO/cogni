// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/credits/TradingWalletConnectFlow`
 * Purpose: First-time trading-wallet provisioning UI rendered inline on the
 *   Money page. Collects the user's default per-order / daily caps and POSTs
 *   `/api/v1/poly/wallet/connect` to spin up a dedicated Privy trading
 *   wallet. Relocated from `/profile` (task.0361) — profile is identity-only.
 * Scope: Client component. POSTs /connect once; the parent (`TradingWalletPanel`)
 *   owns status invalidation so the page flips from "create" to "balances"
 *   without a reload.
 * Invariants:
 *   - DAILY_GE_PER_ORDER: the daily cap is clamped `>= perOrder` to match the
 *     `poly_wallet_grants` CHECK constraint.
 *   - NO_STATUS_REWRITE: this component does not synthesize a
 *     `PolyWalletStatusOutput`; it only reports the raw
 *     `PolyWalletConnectOutput` and leaves query invalidation to the caller.
 *   - IDENTITY_FREE: reads no profile/session data beyond the `userId` passed
 *     in by the parent — keeps the component reusable in any shell.
 * Side-effects: IO (POST /api/v1/poly/wallet/connect).
 * Links: packages/node-contracts/src/poly.wallet.connection.v1.contract.ts,
 *        work/items/task.0318.poly-trading-wallet-port.md,
 *        work/items/task.0361.poly-first-user-onboarding-flow-v0.md
 * @public
 */

"use client";

import type { PolyWalletConnectOutput } from "@cogni/node-contracts";
import { Loader2 } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import { Button } from "@/components";

/**
 * Default slider positions for the first-time consent modal. Chosen to match
 * MIRROR_USDC's current default (~$1) so a new tenant that immediately
 * enables copy-trade can mirror at least one fill per market without
 * tripping the per-order cap.
 */
const DEFAULT_PER_ORDER_CAP_USDC = 2;
const DEFAULT_DAILY_CAP_USDC = 10;

function GrantCapSlider({
  id,
  label,
  min,
  max,
  step,
  value,
  onChange,
  helperText,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (next: number) => void;
  helperText?: string;
}): ReactElement {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="font-medium text-foreground text-sm">
          {label}
        </label>
        <span className="font-mono text-foreground text-sm tabular-nums">
          ${value.toFixed(2)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
      <div className="flex justify-between text-muted-foreground text-xs">
        <span>${min.toFixed(2)}</span>
        {helperText && <span>{helperText}</span>}
        <span>${max.toFixed(2)}</span>
      </div>
    </div>
  );
}

export interface TradingWalletConnectFlowProps {
  readonly userId: string;
  readonly onConnected: (wallet: PolyWalletConnectOutput) => void;
  readonly onCancel?: () => void;
}

export function TradingWalletConnectFlow({
  userId,
  onConnected,
  onCancel,
}: TradingWalletConnectFlowProps): ReactElement {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [perOrderCapUsdc, setPerOrderCapUsdc] = useState(
    DEFAULT_PER_ORDER_CAP_USDC
  );
  const [dailyCapUsdc, setDailyCapUsdc] = useState(DEFAULT_DAILY_CAP_USDC);

  // Keep daily >= per-order (matches DB CHECK on poly_wallet_grants).
  useEffect(() => {
    if (dailyCapUsdc < perOrderCapUsdc) {
      setDailyCapUsdc(perOrderCapUsdc);
    }
  }, [perOrderCapUsdc, dailyCapUsdc]);

  const handleCreate = async (): Promise<void> => {
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/v1/poly/wallet/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          custodialConsentAcknowledged: true,
          custodialConsentActorKind: "user",
          custodialConsentActorId: userId,
          defaultGrant: {
            perOrderUsdcCap: perOrderCapUsdc,
            dailyUsdcCap: dailyCapUsdc,
          },
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "Could not create your trading wallet.";
        setError(message);
        return;
      }
      onConnected(body as PolyWalletConnectOutput);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="space-y-2">
        <div className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          Dedicated trading wallet
        </div>
        <p className="text-muted-foreground text-sm">
          Cogni will create a separate Polymarket trading wallet for your
          account via Privy. This is distinct from your Ethereum sign-in wallet
          and is the wallet copy-trading will fund and use.
        </p>
        <p className="text-muted-foreground text-sm">
          By continuing, you acknowledge that Cogni manages this trading wallet
          on your behalf inside the app and that funding, withdrawals, and
          disconnect controls live here on the Money page.
        </p>
      </div>

      <div className="space-y-3 rounded-md border border-border bg-background p-3">
        <div className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          Trading limits
        </div>
        <p className="text-muted-foreground text-xs">
          Caps the copy-trade pipeline enforces before every order. You can
          revoke the wallet (and the limits) at any time.
        </p>
        <GrantCapSlider
          id="grant-per-order-cap"
          label="Max per trade"
          min={0.5}
          max={20}
          step={0.5}
          value={perOrderCapUsdc}
          onChange={setPerOrderCapUsdc}
        />
        <GrantCapSlider
          id="grant-daily-cap"
          label="Max per day"
          min={Math.max(2, perOrderCapUsdc)}
          max={200}
          step={1}
          value={dailyCapUsdc}
          onChange={setDailyCapUsdc}
        />
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm">
          {error}
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleCreate()}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Creating...
            </>
          ) : (
            "I understand — create trading wallet"
          )}
        </Button>
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
