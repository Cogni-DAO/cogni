// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/setup/dao/payments/PaymentActivationPage.client`
 * Purpose: Client-side payment activation — deploy Split contract via user's connected wallet.
 * Scope: Renders form for operator wallet address, deploys Split via wagmi, shows result with repo-spec YAML. Does not handle Privy provisioning (that is a CLI step).
 * Invariants: SPLIT_CONTROLLER_IS_ADMIN — user's wallet is the Split controller. CHILD_OWNS_OPERATOR_WALLET — operator address is input, not created here.
 * Side-effects: IO (wagmi wallet transactions)
 * Links: docs/spec/node-formation.md
 * @public
 */

"use client";

import { PUSH_SPLIT_V2o2_FACTORY_ADDRESS } from "@0xsplits/splits-sdk/constants";
import { splitV2o2FactoryAbi } from "@0xsplits/splits-sdk/constants/abi";
import {
  calculateSplitAllocations,
  OPENROUTER_CRYPTO_FEE_PPM,
  SPLIT_TOTAL_ALLOCATION,
} from "@cogni/operator-wallet";
import { CheckCircle, Info, Loader2, XCircle } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { decodeEventLog, getAddress } from "viem";
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import {
  Button,
  HintText,
  Input,
  PageContainer,
  SectionCard,
} from "@/components";

/** Default billing constants (PPM). */
const DEFAULT_MARKUP_PPM = 2_000_000n; // 2.0x
const DEFAULT_REVENUE_SHARE_PPM = 750_000n; // 75%

type ActivationPhase =
  | "IDLE"
  | "DEPLOYING"
  | "AWAITING_CONFIRMATION"
  | "SUCCESS"
  | "ERROR";

export function PaymentActivationPageClient(): ReactElement {
  const { address: walletAddress } = useAccount();

  // Form state
  const [operatorWalletAddress, setOperatorWalletAddress] = useState("");
  const [daoTreasuryAddress, setDaoTreasuryAddress] = useState("");

  // Activation state
  const [phase, setPhase] = useState<ActivationPhase>("IDLE");
  const [splitAddress, setSplitAddress] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  // Validation
  const isValidOperator =
    operatorWalletAddress.length > 0 &&
    /^0x[a-fA-F0-9]{40}$/.test(operatorWalletAddress);
  const isValidTreasury =
    daoTreasuryAddress.length > 0 &&
    /^0x[a-fA-F0-9]{40}$/.test(daoTreasuryAddress);
  const canSubmit =
    isValidOperator && isValidTreasury && phase === "IDLE" && !!walletAddress;

  // Derive allocations
  const { operatorAllocation, treasuryAllocation } = calculateSplitAllocations(
    DEFAULT_MARKUP_PPM,
    DEFAULT_REVENUE_SHARE_PPM,
    OPENROUTER_CRYPTO_FEE_PPM
  );

  const handleDeploy = useCallback(() => {
    if (!canSubmit || !walletAddress) return;

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

    // Controller = user's connected wallet (can update allocations later)
    writeContract({
      address: getAddress(PUSH_SPLIT_V2o2_FACTORY_ADDRESS) as Address,
      abi: splitV2o2FactoryAbi,
      functionName: "createSplit",
      args: [
        splitParams,
        walletAddress as Address, // owner
        walletAddress as Address, // creator
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

  // Effect: receipt confirmed — extract Split address
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

  const handleReset = () => {
    resetWrite();
    setPhase("IDLE");
    setSplitAddress(null);
    setErrorMessage(null);
  };

  const repoSpecFragment = splitAddress
    ? `operator_wallet:
  address: "${operatorWalletAddress}"

payments_in:
  credits_topup:
    provider: cogni-usdc-backend-v1
    receiving_address: "${splitAddress}"
    allowed_chains:
      - Base
    allowed_tokens:
      - USDC

payments:
  status: active`
    : "";

  const isInFlight = phase === "DEPLOYING" || phase === "AWAITING_CONFIRMATION";

  return (
    <PageContainer maxWidth="lg">
      <SectionCard title="Activate Payments">
        <HintText icon={<Info size={16} />}>
          Deploy a revenue split contract. Your connected wallet signs the
          transaction and becomes the Split controller.
        </HintText>

        {/* Operator Wallet Address */}
        <div className="space-y-2">
          <label
            htmlFor="operatorWallet"
            className="font-medium text-foreground text-sm"
          >
            Operator Wallet Address
          </label>
          <Input
            id="operatorWallet"
            value={operatorWalletAddress}
            onChange={(e) => setOperatorWalletAddress(e.target.value)}
            placeholder="0x..."
            disabled={isInFlight || phase === "SUCCESS"}
          />
          <p className="text-muted-foreground text-sm">
            Privy-managed wallet. Provision via CLI:{" "}
            <code className="text-xs">pnpm node:activate-payments</code>
          </p>
          {operatorWalletAddress && !isValidOperator && (
            <p className="text-destructive text-sm">Invalid address</p>
          )}
        </div>

        {/* DAO Treasury Address */}
        <div className="space-y-2">
          <label
            htmlFor="daoTreasury"
            className="font-medium text-foreground text-sm"
          >
            DAO Treasury Address
          </label>
          <Input
            id="daoTreasury"
            value={daoTreasuryAddress}
            onChange={(e) => setDaoTreasuryAddress(e.target.value)}
            placeholder="0x... (cogni_dao.dao_contract from repo-spec)"
            disabled={isInFlight || phase === "SUCCESS"}
          />
          <p className="text-muted-foreground text-sm">
            The DAO contract address from your repo-spec (
            <code className="text-xs">cogni_dao.dao_contract</code>)
          </p>
          {daoTreasuryAddress && !isValidTreasury && (
            <p className="text-destructive text-sm">Invalid address</p>
          )}
        </div>

        {/* Allocation Preview */}
        {isValidOperator && isValidTreasury && (
          <div className="rounded-md border bg-muted/50 p-3 text-sm">
            <p className="font-medium">Split Allocation</p>
            <p className="text-muted-foreground">
              Operator ({Number(operatorAllocation) / 1e4}%):{" "}
              {operatorWalletAddress.slice(0, 10)}...
            </p>
            <p className="text-muted-foreground">
              Treasury ({Number(treasuryAllocation) / 1e4}%):{" "}
              {daoTreasuryAddress.slice(0, 10)}...
            </p>
          </div>
        )}

        {/* Deploy Button / Status */}
        {phase === "IDLE" && (
          <Button
            onClick={handleDeploy}
            disabled={!canSubmit}
            className="w-full"
          >
            Deploy Split Contract
          </Button>
        )}

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

        {phase === "SUCCESS" && splitAddress && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-primary">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">Split deployed</span>
            </div>
            <div className="rounded-md border bg-muted/50 p-3">
              <p className="mb-1 font-medium text-sm">
                Add to .cogni/repo-spec.yaml:
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
