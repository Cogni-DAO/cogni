// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/wallet/WithdrawalFlowDialog`
 * Purpose: Reusable two-step wallet withdrawal flow: choose an asset, enter
 *   amount + destination, re-enter destination, acknowledge irreversibility,
 *   submit, and render transaction links.
 * Scope: Presentational client component. Owns local form state only. Callers
 *   provide assets, balances, submit callback, and explorer URL formatting.
 * Invariants: DESTINATION_PASTED_V0; IRREVERSIBLE_CONFIRMATION_REQUIRED;
 *   NO_FETCHING_IN_KIT.
 * Side-effects: callback invocation from user action.
 * @public
 */

"use client";

import { ArrowLeft, CheckCircle2, Send } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/vendor/shadcn/dialog";

export interface WithdrawalAssetOption<AssetId extends string = string> {
  id: AssetId;
  label: string;
  deliveredLabel: string;
  decimals: number;
  balance: number | null | undefined;
  helperText?: string;
  allowMax?: boolean;
  balanceFractionDigits?: number;
}

export interface WithdrawalSubmitInput<AssetId extends string = string> {
  asset: AssetId;
  destination: string;
  amountAtomic: string;
  confirmationDestination: string;
}

export interface WithdrawalSubmitResult {
  txHashes: readonly string[];
}

export interface WithdrawalFlowDialogProps<AssetId extends string = string> {
  title: string;
  triggerLabel: string;
  assets: readonly WithdrawalAssetOption<AssetId>[];
  defaultAsset: AssetId;
  onSubmit: (
    input: WithdrawalSubmitInput<AssetId>
  ) => Promise<WithdrawalSubmitResult>;
  onSubmitted?: (result: WithdrawalSubmitResult) => void;
  getTransactionHref: (hash: string) => string;
}

type Step = "edit" | "confirm" | "done";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function decimalToAtomic(value: string, decimals: number): string | null {
  const trimmed = value.trim();
  if (!/^[0-9]+(?:\.[0-9]*)?$/.test(trimmed)) return null;
  const [whole = "", frac = ""] = trimmed.split(".");
  if (frac.length > decimals) return null;
  const wholeAtomic = BigInt(whole) * 10n ** BigInt(decimals);
  const fracAtomic = BigInt((frac + "0".repeat(decimals)).slice(0, decimals));
  const atomic = wholeAtomic + fracAtomic;
  return atomic > 0n ? atomic.toString() : null;
}

function formatBalanceForInput(
  value: number | null | undefined,
  fractionDigits: number
): string {
  if (value === null || value === undefined) return "";
  const formatted = value.toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: fractionDigits,
  });
  return formatted.includes(".") ? formatted.replace(/\.?0+$/, "") : formatted;
}

export function WithdrawalFlowDialog<AssetId extends string = string>({
  title,
  triggerLabel,
  assets,
  defaultAsset,
  onSubmit,
  onSubmitted,
  getTransactionHref,
}: WithdrawalFlowDialogProps<AssetId>): ReactElement {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("edit");
  const [asset, setAsset] = useState<AssetId>(defaultAsset);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [confirmDestination, setConfirmDestination] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<WithdrawalSubmitResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected =
    assets.find((candidate) => candidate.id === asset) ?? assets[0];
  if (!selected) {
    throw new Error("WithdrawalFlowDialog requires at least one asset");
  }

  const amountAtomic = useMemo(
    () => decimalToAtomic(amount, selected.decimals),
    [amount, selected.decimals]
  );
  const destinationValid = ADDRESS_RE.test(destination);
  const confirmValid =
    ADDRESS_RE.test(confirmDestination) &&
    sameAddress(confirmDestination, destination) &&
    acknowledged;
  const canReview = destinationValid && amountAtomic !== null;
  const balanceText = formatBalanceForInput(
    selected.balance,
    selected.balanceFractionDigits ?? selected.decimals
  );

  function reset(): void {
    setStep("edit");
    setAsset(defaultAsset);
    setDestination("");
    setAmount("");
    setConfirmDestination("");
    setAcknowledged(false);
    setResult(null);
    setPending(false);
    setError(null);
  }

  async function submit(): Promise<void> {
    if (!amountAtomic || !confirmValid) return;
    setPending(true);
    setError(null);
    try {
      const payload = await onSubmit({
        asset,
        destination,
        amountAtomic,
        confirmationDestination: confirmDestination,
      });
      setResult(payload);
      setStep("done");
      onSubmitted?.(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "withdraw_failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && !pending) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="w-full rounded-md border border-primary/40 bg-primary/10 px-3 py-2 font-medium text-primary text-sm transition-colors hover:bg-primary/20"
        >
          {triggerLabel}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {step === "edit" ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              {assets.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => setAsset(candidate.id)}
                  className={
                    candidate.id === asset
                      ? "rounded-md border border-primary bg-primary/10 px-3 py-2 text-left font-medium text-primary text-sm"
                      : "rounded-md border border-border bg-background px-3 py-2 text-left font-medium text-muted-foreground text-sm hover:bg-muted/50"
                  }
                >
                  {candidate.label}
                </button>
              ))}
            </div>

            <div className="rounded-md bg-muted/40 px-3 py-2">
              <div className="text-muted-foreground text-xs uppercase tracking-wide">
                Available
              </div>
              <div className="font-semibold text-xl tabular-nums">
                {selected.balance === null || selected.balance === undefined
                  ? "-"
                  : balanceText}{" "}
                {selected.label}
              </div>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Destination address</span>
              <input
                value={destination}
                onChange={(event) => setDestination(event.target.value.trim())}
                placeholder="0x..."
                className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Amount</span>
              <div className="flex gap-2">
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                {selected.allowMax === false ? null : (
                  <button
                    type="button"
                    onClick={() => setAmount(balanceText)}
                    disabled={
                      selected.balance === null ||
                      selected.balance === undefined ||
                      balanceText === ""
                    }
                    className="rounded-md border border-border px-3 py-2 font-medium text-sm disabled:cursor-not-allowed disabled:text-muted-foreground"
                  >
                    Max
                  </button>
                )}
              </div>
            </label>

            {selected.helperText ? (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground text-xs leading-snug">
                {selected.helperText}
              </p>
            ) : null}

            <button
              type="button"
              disabled={!canReview}
              onClick={() => setStep("confirm")}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Review <Send size={15} />
            </button>
          </div>
        ) : null}

        {step === "confirm" ? (
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setStep("edit")}
              className="inline-flex w-fit items-center gap-2 text-muted-foreground text-sm hover:text-foreground"
            >
              <ArrowLeft size={15} /> Back
            </button>

            <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Withdraw</span>
                <span className="font-medium">
                  {amount} {selected.label}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Receives</span>
                <span className="font-medium">{selected.deliveredLabel}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">Destination</span>
                <span className="break-all font-mono text-xs">
                  {destination}
                </span>
              </div>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Paste destination again</span>
              <input
                value={confirmDestination}
                onChange={(event) =>
                  setConfirmDestination(event.target.value.trim())
                }
                placeholder="0x..."
                className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
              />
            </label>

            <label className="flex items-start gap-2 text-sm leading-snug">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                I understand this transaction cannot be reversed after it is
                submitted.
              </span>
            </label>

            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              disabled={!confirmValid || pending}
              onClick={() => void submit()}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Submitting..." : "Submit withdrawal"}
            </button>
          </div>
        ) : null}

        {step === "done" && result ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-primary text-sm">
              <CheckCircle2 size={16} />
              Withdrawal submitted
            </div>
            <div className="grid gap-2 text-sm">
              {result.txHashes.map((hash, index) => (
                <a
                  key={hash}
                  href={getTransactionHref(hash)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="break-all rounded-md border border-border px-3 py-2 font-mono text-xs hover:bg-muted/50"
                >
                  {index === result.txHashes.length - 1
                    ? "Withdrawal"
                    : "Approval"}{" "}
                  {hash}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
