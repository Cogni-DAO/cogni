// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/nodes/payments/PaymentActivationPage.client`
 * Purpose: Client-side payment activation — deploy Split contract via user's connected wallet.
 * Scope: Reads operator wallet + DAO treasury from server props, deploys Split via wagmi. Does not handle Privy provisioning.
 * Invariants: SPLIT_CONTROLLER_IS_ADMIN — user's wallet is the Split controller. Addresses from repo-spec, not user input.
 * Side-effects: IO (wagmi wallet transactions)
 * Links: docs/spec/node-formation.md
 * @public
 */

"use client";

import { PUSH_SPLIT_V2o2_FACTORY_ADDRESS } from "@0xsplits/splits-sdk/constants";
import { splitV2o2FactoryAbi } from "@0xsplits/splits-sdk/constants/abi";
import {
  calculateSplitAllocations,
  numberToPpm,
  OPENROUTER_CRYPTO_FEE_PPM,
  SPLIT_TOTAL_ALLOCATION,
} from "@cogni/operator-wallet";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Clipboard,
  Info,
  Loader2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { decodeEventLog, getAddress } from "viem";
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { Button, HintText, PageContainer, SectionCard } from "@/components";

/** Default payment activation economics: 95% provider top-up / 5% DAO margin. */
const DEFAULT_MARKUP_FACTOR = 1.10803324099723;
const DEFAULT_REVENUE_SHARE = 0;

function buildAiDevSetupPrompt(nodeId: string | null | undefined): string {
  const nodeLine = nodeId
    ? `Node id: ${nodeId}\nOperator activation page: /nodes/${nodeId}/payments`
    : "Node id: ask the human for the node dashboard URL before changing files.";

  return `You are activating payment rails for my Cogni node.

${nodeLine}

Goal: provision a node-owned Privy operator wallet, store its secrets for the node, write the public operator wallet address into the node repo-spec/operator registry, then return me to the operator payment activation page to deploy the Split contract.

Human steps:
1. Open the Privy dashboard and create or select the dedicated operator-wallet app for this node.
2. Copy the app id, app secret, and wallet signing key into a local env file for the AI dev only. Do not paste secret values into chat.
3. Let the AI dev run the repo's documented secret-add flow for the node and environment.

AI dev steps:
1. Read docs/guides/operator-wallet-setup.md and docs/guides/secrets-add-new.md.
2. Add the node's PRIVY_APP_ID, PRIVY_APP_SECRET, and PRIVY_SIGNING_KEY to the node's candidate-a secret path.
3. Provision or resolve the Privy-managed operator wallet.
4. Update the node's .cogni/repo-spec.yaml with operator_wallet.address.
5. Ensure the operator node registry row has operator_wallet_address for this node.
6. Ask the human to reopen the operator payment activation page and deploy the Split contract.

Stop before logging or committing any secret value.`;
}

type ActivationPhase =
  | "IDLE"
  | "DEPLOYING"
  | "AWAITING_CONFIRMATION"
  | "SUCCESS"
  | "ERROR";

interface Props {
  /** From nodes.operator_wallet_address — null if not configured */
  operatorWalletAddress: string | null;
  /** From nodes.dao_address — null if not configured */
  daoTreasuryAddress: string | null;
  /** Persist the Split address back to the node row on success. */
  nodeId?: string | null;
}

export function PaymentActivationPageClient({
  operatorWalletAddress,
  daoTreasuryAddress,
  nodeId,
}: Props): ReactElement {
  const { address: walletAddress } = useAccount();
  const router = useRouter();
  const patchedRef = useRef(false);

  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<ActivationPhase>("IDLE");
  const [splitAddress, setSplitAddress] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedSetupPrompt, setCopiedSetupPrompt] = useState(false);

  // Wagmi
  const {
    writeContract,
    data: txHash,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const { data: receipt, error: receiptError } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Readiness checks
  const hasOperator = !!operatorWalletAddress;
  const hasTreasury = !!daoTreasuryAddress;
  const isReady = hasOperator && hasTreasury;
  const canSubmit = isReady && confirmed && phase === "IDLE" && !!walletAddress;
  const nodeDashboardHref = nodeId ? `/nodes/${nodeId}` : "/nodes";

  // Derive allocations
  const { operatorAllocation, treasuryAllocation } = calculateSplitAllocations(
    numberToPpm(DEFAULT_MARKUP_FACTOR),
    numberToPpm(DEFAULT_REVENUE_SHARE),
    OPENROUTER_CRYPTO_FEE_PPM
  );

  const handleDeploy = useCallback(() => {
    if (
      !canSubmit ||
      !walletAddress ||
      !operatorWalletAddress ||
      !daoTreasuryAddress
    )
      return;

    setPhase("DEPLOYING");
    setErrorMessage(null);
    setSplitAddress(null);

    const operator = getAddress(operatorWalletAddress) as Address;
    const treasury = getAddress(daoTreasuryAddress) as Address;

    // Sort recipients ascending (0xSplits requirement)
    const entries = [
      { address: operator, allocation: operatorAllocation },
      { address: treasury, allocation: treasuryAllocation },
    ].sort((a, b) =>
      a.address.toLowerCase().localeCompare(b.address.toLowerCase())
    );

    const splitParams = {
      recipients: entries.map((e) => e.address) as readonly Address[],
      allocations: entries.map((e) => e.allocation) as readonly bigint[],
      totalAllocation: SPLIT_TOTAL_ALLOCATION,
      distributionIncentive: 0,
    };

    writeContract({
      address: getAddress(PUSH_SPLIT_V2o2_FACTORY_ADDRESS) as Address,
      abi: splitV2o2FactoryAbi,
      functionName: "createSplit",
      args: [
        splitParams,
        operator, // owner/controller — operator wallet can update allocations programmatically
        walletAddress as Address, // creator — the deployer who signs this tx
      ],
    });
  }, [
    canSubmit,
    walletAddress,
    operatorWalletAddress,
    daoTreasuryAddress,
    operatorAllocation,
    treasuryAllocation,
    writeContract,
  ]);

  // Effect: tx hash received
  useEffect(() => {
    if (txHash && phase === "DEPLOYING") {
      setPhase("AWAITING_CONFIRMATION");
    }
  }, [txHash, phase]);

  // Effect: receipt confirmed
  useEffect(() => {
    if (receipt && phase === "AWAITING_CONFIRMATION") {
      let addr: string | undefined;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: splitV2o2FactoryAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "SplitCreated") {
            addr = (decoded.args as { split: Address }).split;
            break;
          }
        } catch {
          // Not our event
        }
      }
      if (addr) {
        setSplitAddress(addr);
        setPhase("SUCCESS");
      } else {
        setErrorMessage("Could not extract Split address from receipt");
        setPhase("ERROR");
      }
    }
  }, [receipt, phase]);

  // Effect: errors
  useEffect(() => {
    if (writeError && phase === "DEPLOYING") {
      setErrorMessage(writeError.message || "Split deployment failed");
      setPhase("ERROR");
    }
  }, [writeError, phase]);

  useEffect(() => {
    if (receiptError && phase === "AWAITING_CONFIRMATION") {
      setErrorMessage(receiptError.message || "Transaction failed");
      setPhase("ERROR");
    }
  }, [receiptError, phase]);

  // When invoked from the external-node wizard, PATCH the Split address back to
  // the node row and redirect to the dashboard. No-op when nodeId is absent.
  useEffect(() => {
    if (!nodeId) return;
    if (phase !== "SUCCESS" || !splitAddress) return;
    if (patchedRef.current) return;
    patchedRef.current = true;

    void (async () => {
      try {
        const response = await fetch(`/api/v1/nodes/${nodeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: { type: "payments_configured" },
            splitAddress,
            splitTxHash: txHash,
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || `HTTP ${response.status}`);
        }

        router.push(`/nodes/${nodeId}`);
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        setErrorMessage(
          `Split deployed at ${splitAddress}, but the node dashboard update failed: ${details}`
        );
        setPhase("ERROR");
      }
    })();
  }, [nodeId, phase, splitAddress, txHash, router]);

  const handleReset = () => {
    resetWrite();
    setPhase("IDLE");
    setSplitAddress(null);
    setErrorMessage(null);
    setConfirmed(false);
  };

  const handleCopySetupPrompt = async () => {
    await navigator.clipboard.writeText(buildAiDevSetupPrompt(nodeId));
    setCopiedSetupPrompt(true);
    window.setTimeout(() => setCopiedSetupPrompt(false), 2000);
  };

  const repoSpecFragment = splitAddress
    ? `payments_in:
  credits_topup:
    provider: cogni-usdc-backend-v1
    receiving_address: "${splitAddress}"
    allowed_chains:
      - Base
    allowed_tokens:
      - USDC
    markup_factor: ${DEFAULT_MARKUP_FACTOR}
    revenue_share: ${DEFAULT_REVENUE_SHARE}

payments:
  status: active`
    : "";

  const isInFlight = phase === "DEPLOYING" || phase === "AWAITING_CONFIRMATION";

  // --- Not ready: missing prerequisites ---
  if (!isReady) {
    return (
      <PageContainer maxWidth="lg">
        <Button asChild variant="ghost" className="mb-4 gap-2">
          <Link href={nodeDashboardHref}>
            <ArrowLeft className="size-4" />
            Node dashboard
          </Link>
        </Button>
        <SectionCard title="Activate Payments">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-medium">Prerequisites missing</span>
            </div>

            <div className="space-y-2 text-sm">
              {!hasTreasury && (
                <p className="text-destructive">
                  ✗ <code>dao_address</code> is missing for this node. Complete
                  DAO formation before activating payment rails.
                </p>
              )}
              {!hasOperator && (
                <p className="text-destructive">
                  ✗ <code>operator_wallet_address</code> is missing for this
                  node. Provision a node-owned Privy operator wallet, store its
                  secrets for this node, and write the public wallet address to
                  the node registry and <code>.cogni/repo-spec.yaml</code>.
                </p>
              )}
            </div>

            <HintText icon={<Info size={16} />}>
              This node-scoped page reads the operator node registry row. The
              node repo-spec should match it, but the root operator repo-spec is
              not used as a fallback.
            </HintText>

            {!hasOperator && (
              <div className="space-y-3 rounded-md border bg-muted/40 p-4">
                <p className="text-muted-foreground text-sm">
                  Give this prompt to an AI developer with repo access. The
                  human only needs to create/copy Privy values; the AI handles
                  secrets, wallet provisioning, and repo-spec updates.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopySetupPrompt}
                  className="gap-2"
                >
                  {copiedSetupPrompt ? (
                    <CheckCircle className="size-4" />
                  ) : (
                    <Clipboard className="size-4" />
                  )}
                  {copiedSetupPrompt ? "Copied" : "Copy AI-dev setup prompt"}
                </Button>
              </div>
            )}
          </div>
        </SectionCard>
      </PageContainer>
    );
  }

  // --- Ready: show form ---
  return (
    <PageContainer maxWidth="lg">
      <Button asChild variant="ghost" className="mb-4 gap-2">
        <Link href={nodeDashboardHref}>
          <ArrowLeft className="size-4" />
          Node dashboard
        </Link>
      </Button>
      <SectionCard title="Activate Payments">
        <HintText icon={<Info size={16} />}>
          Deploy a revenue split contract on Base. Your connected wallet signs
          the transaction and becomes the Split controller.
        </HintText>

        {/* Read-only node registry addresses */}
        <div className="space-y-2 rounded-md border bg-muted/50 p-4 text-sm">
          <p>
            <span className="font-medium">Operator wallet:</span>{" "}
            <code className="text-xs">{operatorWalletAddress}</code>
          </p>
          <p>
            <span className="font-medium">DAO treasury:</span>{" "}
            <code className="text-xs">{daoTreasuryAddress}</code>
          </p>
          <p className="text-muted-foreground">
            Operator ({Number(operatorAllocation) / 1e4}%) / Treasury (
            {Number(treasuryAllocation) / 1e4}%)
          </p>
        </div>

        {/* Confirmation checkbox */}
        {phase === "IDLE" && (
          <>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-border"
              />
              <span className="text-muted-foreground text-sm">
                I am deploying this for my new node&apos;s codebase. The
                addresses above are correct.
              </span>
            </label>

            <Button
              onClick={handleDeploy}
              disabled={!canSubmit}
              className="w-full"
            >
              Deploy Split Contract
            </Button>
          </>
        )}

        {/* In-flight */}
        {isInFlight && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground text-sm">
              {phase === "DEPLOYING"
                ? "Confirm in your wallet..."
                : "Confirming transaction..."}
            </p>
          </div>
        )}

        {/* Success */}
        {phase === "SUCCESS" && splitAddress && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-primary">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">Split deployed</span>
            </div>
            <div className="rounded-md border bg-muted/50 p-3">
              <p className="mb-1 font-medium text-sm">
                Add to <code>.cogni/repo-spec.yaml</code>:
              </p>
              <pre className="overflow-x-auto text-xs">{repoSpecFragment}</pre>
            </div>
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(repoSpecFragment)}
              className="w-full"
            >
              Copy to Clipboard
            </Button>
            <Button variant="ghost" onClick={handleReset} className="w-full">
              Deploy Another
            </Button>
          </div>
        )}

        {/* Error */}
        {phase === "ERROR" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              <span className="font-medium">Deployment failed</span>
            </div>
            <p className="text-muted-foreground text-sm">{errorMessage}</p>
            <Button variant="outline" onClick={handleReset} className="w-full">
              Try Again
            </Button>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  );
}
