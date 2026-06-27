// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/nodes/wizard/steps/PaymentActivationStep.client`
 * Purpose: Wizard-native payment activation for an external node.
 * Scope: Deploys the payment Split with the connected wallet, records it on the node row, then asks
 *   the operator GitHub App to open the node-repo PR that writes payment config into `.cogni/repo-spec.yaml`.
 * Side-effects: IO (wagmi transaction, PATCH node row, POST activation route, clipboard)
 * Links: src/app/api/v1/nodes/[id]/activate-payments/route.ts, src/features/nodes/wizard/step-registry.tsx
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
  CheckCircle,
  Clipboard,
  ExternalLink,
  Info,
  Loader2,
  Wallet,
  XCircle,
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { decodeEventLog, getAddress } from "viem";
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { Button, HintText } from "@/components";

import { LaunchPackCopyButton } from "../LaunchPackCopyButton.client";
import { StepSection } from "../StepSection";
import type { WizardStepProps } from "../types";

/** Default payment activation economics: 95% provider top-up / 5% DAO margin. */
const DEFAULT_MARKUP_FACTOR = 1.10803324099723;
const DEFAULT_REVENUE_SHARE = 0;

type SplitPhase =
  | "IDLE"
  | "DEPLOYING"
  | "AWAITING_CONFIRMATION"
  | "SUCCESS"
  | "ERROR";

type RepoActivationPhase = "IDLE" | "OPENING" | "DONE" | "ERROR";

interface ActivationResult {
  readonly status: "pr_opened" | "no_changes";
  readonly prNumber?: number;
  readonly prUrl?: string;
}

function formatPercent(allocation: bigint): string {
  return `${Number(allocation) / 1e4}%`;
}

function buildPrivySetupPrompt(input: {
  readonly nodeId: string;
  readonly nodeSlug: string;
  readonly nodeRepoUrl: string | null;
  readonly repoSpecUrl: string | null;
}): string {
  return `You are activating the operator wallet prerequisites for my Cogni node.

Node: ${input.nodeSlug}
Node id: ${input.nodeId}
Node repo: ${input.nodeRepoUrl ?? "open the node dashboard for the repo link"}
Repo spec: ${input.repoSpecUrl ?? ".cogni/repo-spec.yaml in the node repo"}

Goal: provision a node-owned Privy operator wallet, store its secrets for the node, write the public operator wallet address into .cogni/repo-spec.yaml and the operator node registry, then return me to the node dashboard so I can deploy the payment Split.

Human steps:
1. Open the Privy dashboard and create or select the dedicated operator-wallet app for this node.
2. Copy the app id, app secret, and wallet signing key into a local env file for the AI dev only. Do not paste secret values into chat.

AI dev steps:
1. Read docs/guides/operator-wallet-setup.md and docs/guides/secrets-add-new.md.
2. Add the node's PRIVY_APP_ID, PRIVY_APP_SECRET, and PRIVY_SIGNING_KEY to candidate-a secrets.
3. Provision or resolve the Privy-managed operator wallet.
4. Update .cogni/repo-spec.yaml with operator_wallet.address.
5. Ensure the operator node registry row has operator_wallet_address for this node.
6. Run the required checks and flight, then send the human back to the node dashboard.

Never log, commit, or paste secret values.`;
}

function buildFollowThroughPrompt(input: {
  readonly nodeSlug: string;
  readonly nodeRepoUrl: string | null;
  readonly activationPrUrl: string;
}): string {
  return `You are finishing payment activation for my Cogni node.

Node: ${input.nodeSlug}
Node repo: ${input.nodeRepoUrl ?? "open the node dashboard for the repo link"}
Activation PR: ${input.activationPrUrl}

Review the cogni-operator-authored payment activation PR, run the required node CI/flight sequence, merge it when green, then validate the node app on test with a small USDC credits/top-up payment. Do not add secrets to git.`;
}

function AddressRows({
  operatorWalletAddress,
  daoTreasuryAddress,
  operatorAllocation,
  treasuryAllocation,
}: {
  readonly operatorWalletAddress: string | null;
  readonly daoTreasuryAddress: string | null;
  readonly operatorAllocation: bigint;
  readonly treasuryAllocation: bigint;
}): ReactElement {
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 p-4 text-sm">
      <p>
        <span className="font-medium">Operator wallet:</span>{" "}
        <code className="break-all text-xs">
          {operatorWalletAddress ?? "Missing"}
        </code>
      </p>
      <p>
        <span className="font-medium">DAO treasury:</span>{" "}
        <code className="break-all text-xs">
          {daoTreasuryAddress ?? "Missing"}
        </code>
      </p>
      <p className="text-muted-foreground">
        Split allocation: operator {formatPercent(operatorAllocation)} /
        treasury {formatPercent(treasuryAllocation)}
      </p>
    </div>
  );
}

export function PaymentActivationStep({ node }: WizardStepProps): ReactElement {
  const { address: walletAddress } = useAccount();
  const patchedRef = useRef(false);

  const [splitPhase, setSplitPhase] = useState<SplitPhase>("IDLE");
  const [repoPhase, setRepoPhase] = useState<RepoActivationPhase>("IDLE");
  const [splitAddress, setSplitAddress] = useState<string | null>(null);
  const [activationResult, setActivationResult] =
    useState<ActivationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<"setup" | "handoff" | null>(null);

  const {
    writeContract,
    data: txHash,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const { data: receipt, error: receiptError } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const hasOperator = !!node.operatorWalletAddress;
  const hasTreasury = !!node.daoAddress;
  const isReady = hasOperator && hasTreasury;
  const isInFlight =
    splitPhase === "DEPLOYING" || splitPhase === "AWAITING_CONFIRMATION";
  const effectiveSplitAddress = splitAddress ?? node.splitAddress;
  const splitIsDeployed = !!effectiveSplitAddress;
  const repoWriteIsDone = repoPhase === "DONE" || node.status === "active";
  const canDeploySplit =
    isReady &&
    splitPhase === "IDLE" &&
    node.status === "wallet_ready" &&
    !!walletAddress;
  const canOpenActivationPr =
    splitIsDeployed &&
    !repoWriteIsDone &&
    repoPhase !== "OPENING" &&
    node.status !== "wallet_ready";

  const { operatorAllocation, treasuryAllocation } = calculateSplitAllocations(
    numberToPpm(DEFAULT_MARKUP_FACTOR),
    numberToPpm(DEFAULT_REVENUE_SHARE),
    OPENROUTER_CRYPTO_FEE_PPM
  );

  const setupPrompt = useMemo(
    () =>
      buildPrivySetupPrompt({
        nodeId: node.id,
        nodeSlug: node.slug,
        nodeRepoUrl: node.nodeRepoUrl,
        repoSpecUrl: node.repoSpecUrl,
      }),
    [node.id, node.slug, node.nodeRepoUrl, node.repoSpecUrl]
  );

  const followThroughPrompt = activationResult?.prUrl
    ? buildFollowThroughPrompt({
        nodeSlug: node.slug,
        nodeRepoUrl: node.nodeRepoUrl,
        activationPrUrl: activationResult.prUrl,
      })
    : null;

  const openActivationPr = useCallback(async () => {
    setErrorMessage(null);
    setRepoPhase("OPENING");
    try {
      const response = await fetch(
        `/api/v1/nodes/${node.id}/activate-payments`,
        { method: "POST" }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason =
          typeof body.reason === "string"
            ? body.reason
            : typeof body.error === "string"
              ? body.error
              : `HTTP ${response.status}`;
        throw new Error(reason);
      }

      const activation = body.activation as ActivationResult | undefined;
      setActivationResult(
        activation ?? {
          status: "no_changes",
        }
      );
      setRepoPhase("DONE");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "payment activation PR failed"
      );
      setRepoPhase("ERROR");
    }
  }, [node.id]);

  const handleDeploy = useCallback(() => {
    if (
      !canDeploySplit ||
      !walletAddress ||
      !node.operatorWalletAddress ||
      !node.daoAddress
    ) {
      return;
    }

    setSplitPhase("DEPLOYING");
    setErrorMessage(null);
    setSplitAddress(null);
    setActivationResult(null);
    setRepoPhase("IDLE");

    const operator = getAddress(node.operatorWalletAddress) as Address;
    const treasury = getAddress(node.daoAddress) as Address;
    const entries = [
      { address: operator, allocation: operatorAllocation },
      { address: treasury, allocation: treasuryAllocation },
    ].sort((a, b) =>
      a.address.toLowerCase().localeCompare(b.address.toLowerCase())
    );

    writeContract({
      address: getAddress(PUSH_SPLIT_V2o2_FACTORY_ADDRESS) as Address,
      abi: splitV2o2FactoryAbi,
      functionName: "createSplit",
      args: [
        {
          recipients: entries.map(
            (entry) => entry.address
          ) as readonly Address[],
          allocations: entries.map(
            (entry) => entry.allocation
          ) as readonly bigint[],
          totalAllocation: SPLIT_TOTAL_ALLOCATION,
          distributionIncentive: 0,
        },
        operator,
        walletAddress as Address,
      ],
    });
  }, [
    canDeploySplit,
    walletAddress,
    node.operatorWalletAddress,
    node.daoAddress,
    operatorAllocation,
    treasuryAllocation,
    writeContract,
  ]);

  useEffect(() => {
    if (txHash && splitPhase === "DEPLOYING") {
      setSplitPhase("AWAITING_CONFIRMATION");
    }
  }, [txHash, splitPhase]);

  useEffect(() => {
    if (receipt && splitPhase === "AWAITING_CONFIRMATION") {
      let deployedSplitAddress: string | undefined;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: splitV2o2FactoryAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "SplitCreated") {
            deployedSplitAddress = (decoded.args as { split: Address }).split;
            break;
          }
        } catch {
          // Ignore unrelated logs in the transaction receipt.
        }
      }

      if (deployedSplitAddress) {
        setSplitAddress(deployedSplitAddress);
        setSplitPhase("SUCCESS");
      } else {
        setErrorMessage(
          "Could not extract the Split address from the receipt."
        );
        setSplitPhase("ERROR");
      }
    }
  }, [receipt, splitPhase]);

  useEffect(() => {
    if (writeError && splitPhase === "DEPLOYING") {
      setErrorMessage(writeError.message || "Split deployment failed.");
      setSplitPhase("ERROR");
    }
  }, [writeError, splitPhase]);

  useEffect(() => {
    if (receiptError && splitPhase === "AWAITING_CONFIRMATION") {
      setErrorMessage(
        receiptError.message || "Transaction confirmation failed."
      );
      setSplitPhase("ERROR");
    }
  }, [receiptError, splitPhase]);

  useEffect(() => {
    if (splitPhase !== "SUCCESS" || !splitAddress || patchedRef.current) {
      return;
    }
    patchedRef.current = true;

    void (async () => {
      try {
        const response = await fetch(`/api/v1/nodes/${node.id}`, {
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

        await openActivationPr();
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        setErrorMessage(
          `Split deployed at ${splitAddress}, but follow-through failed: ${details}`
        );
        setSplitPhase("ERROR");
      }
    })();
  }, [node.id, openActivationPr, splitAddress, splitPhase, txHash]);

  const copyText = async (text: string, label: "setup" | "handoff") => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 2000);
  };

  const handleReset = () => {
    resetWrite();
    patchedRef.current = false;
    setSplitPhase("IDLE");
    setRepoPhase("IDLE");
    setSplitAddress(null);
    setActivationResult(null);
    setErrorMessage(null);
  };

  return (
    <StepSection
      title={
        repoWriteIsDone ? "Payments activation PR ready" : "Activate payments"
      }
    >
      <div className="space-y-5 text-sm">
        <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-4 sm:grid-cols-2">
          <p>
            <span className="block text-muted-foreground text-xs">Node</span>
            <span className="font-medium">{node.slug}</span>
          </p>
          <p>
            <span className="block text-muted-foreground text-xs">Node ID</span>
            <code className="break-all text-xs">{node.id}</code>
          </p>
          {node.nodeRepoUrl ? (
            <a
              href={node.nodeRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:underline"
            >
              Node repo
              <ExternalLink className="size-3.5" />
            </a>
          ) : (
            <span className="text-muted-foreground">Node repo unavailable</span>
          )}
          {node.repoSpecUrl ? (
            <a
              href={node.repoSpecUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:underline"
            >
              .cogni/repo-spec.yaml
              <ExternalLink className="size-3.5" />
            </a>
          ) : (
            <span className="text-muted-foreground">
              Repo-spec link unavailable
            </span>
          )}
        </div>

        {!isReady ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-foreground">
                  Payment prerequisites are not ready yet
                </p>
                <p>
                  The operator must know this node's DAO treasury and node-owned
                  operator wallet before it can deploy a Split.
                </p>
              </div>
            </div>

            <AddressRows
              operatorWalletAddress={node.operatorWalletAddress}
              daoTreasuryAddress={node.daoAddress}
              operatorAllocation={operatorAllocation}
              treasuryAllocation={treasuryAllocation}
            />

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => copyText(setupPrompt, "setup")}
                className="gap-2"
              >
                {copied === "setup" ? (
                  <CheckCircle className="size-4" />
                ) : (
                  <Clipboard className="size-4" />
                )}
                {copied === "setup" ? "Copied" : "Copy AI-dev setup prompt"}
              </Button>
              <LaunchPackCopyButton nodeId={node.id} variant="secondary" />
            </div>
          </div>
        ) : null}

        {isReady && !splitIsDeployed ? (
          <div className="space-y-4">
            <HintText icon={<Info size={16} />}>
              The operator resolved these addresses from this node's registry
              row. The repo-spec link above is the audit trail; the user does
              not need to manually validate address text.
            </HintText>

            <AddressRows
              operatorWalletAddress={node.operatorWalletAddress}
              daoTreasuryAddress={node.daoAddress}
              operatorAllocation={operatorAllocation}
              treasuryAllocation={treasuryAllocation}
            />

            <div className="rounded-md border border-border bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                <Wallet className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="space-y-1">
                  <p className="font-medium">What your wallet confirms</p>
                  <p className="text-muted-foreground">
                    One Base transaction deploys a 0xSplits contract. Your
                    wallet pays gas and is recorded as the creator; the node
                    operator wallet becomes the Split controller. This does not
                    make your wallet the node owner or treasury.
                  </p>
                </div>
              </div>
            </div>

            <Button
              type="button"
              onClick={handleDeploy}
              disabled={!canDeploySplit}
              className="w-full gap-2"
            >
              {isInFlight ? <Loader2 className="size-4 animate-spin" /> : null}
              {!walletAddress
                ? "Connect wallet to deploy Split"
                : "Deploy payment Split"}
            </Button>
          </div>
        ) : null}

        {isInFlight ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-muted-foreground">
              {splitPhase === "DEPLOYING"
                ? "Confirm the Base transaction in your wallet."
                : "Waiting for the transaction to confirm on Base."}
            </p>
          </div>
        ) : null}

        {splitIsDeployed ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2">
              <CheckCircle className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium">Payment Split is deployed</p>
                <p className="text-muted-foreground">
                  Next, cogni-operator opens a PR in the node repo that writes
                  the Split and node wallet into{" "}
                  <code>.cogni/repo-spec.yaml</code>.
                </p>
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-4">
              <p>
                <span className="font-medium">Split receiving address:</span>{" "}
                <code className="break-all text-xs">
                  {effectiveSplitAddress}
                </code>
              </p>
              {txHash ? (
                <p>
                  <span className="font-medium">Deployment tx:</span>{" "}
                  <code className="break-all text-xs">{txHash}</code>
                </p>
              ) : null}
            </div>

            {repoPhase === "OPENING" ? (
              <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-4">
                <Loader2 className="size-5 animate-spin text-primary" />
                <p className="text-muted-foreground">
                  Opening activation PR in the node repo...
                </p>
              </div>
            ) : null}

            {repoWriteIsDone ? (
              <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
                <p className="font-medium">
                  {activationResult?.status === "pr_opened"
                    ? "Activation PR opened"
                    : "Payment repo-spec write-back is already handled"}
                </p>
                {activationResult?.prUrl ? (
                  <Button asChild className="w-full sm:w-auto">
                    <a
                      href={activationResult.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View activation PR
                      <ExternalLink className="size-4" />
                    </a>
                  </Button>
                ) : null}
                <HintText icon={<Info size={16} />}>
                  Merge and flight the activation PR before testing a real
                  credits/top-up payment in the node app.
                </HintText>
              </div>
            ) : null}

            {canOpenActivationPr ? (
              <Button
                type="button"
                onClick={openActivationPr}
                className="w-full gap-2"
              >
                Open activation PR
              </Button>
            ) : null}

            {followThroughPrompt ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => copyText(followThroughPrompt, "handoff")}
                className="w-full gap-2"
              >
                {copied === "handoff" ? (
                  <CheckCircle className="size-4" />
                ) : (
                  <Clipboard className="size-4" />
                )}
                {copied === "handoff" ? "Copied" : "Copy AI-dev follow-through"}
              </Button>
            ) : null}
          </div>
        ) : null}

        {splitPhase === "ERROR" || repoPhase === "ERROR" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="size-5" />
              <span className="font-medium">
                Payment activation hit an error
              </span>
            </div>
            <p className="text-muted-foreground">{errorMessage}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {repoPhase === "ERROR" && splitIsDeployed ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={openActivationPr}
                  className="w-full"
                >
                  Try opening activation PR again
                </Button>
              ) : null}
              {splitPhase === "ERROR" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleReset}
                  className="w-full"
                >
                  Try Split deploy again
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </StepSection>
  );
}
