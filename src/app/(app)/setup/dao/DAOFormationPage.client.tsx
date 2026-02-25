// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/setup/dao/DAOFormationPage.client`
 * Purpose: Client-side DAO formation page with form input and wallet-signed transaction flow.
 * Scope: Renders form for DAO config, triggers formation via useDAOFormation hook, shows dialog for progress. Does not contain transaction logic or state machine implementation.
 * Invariants: Form validation inline; initialHolder defaults to connected wallet address.
 * Side-effects: IO (useDAOFormation hook performs wallet transactions).
 * Links: docs/spec/node-formation.md
 * @public
 */

"use client";

import { Info } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";

import {
  Button,
  HintText,
  Input,
  PageContainer,
  SectionCard,
} from "@/components";
import { FormationFlowDialog } from "@/features/setup/components/FormationFlowDialog";
import { useDAOFormation } from "@/features/setup/hooks/useDAOFormation";

export function DAOFormationPageClient(): ReactElement {
  const { address: walletAddress } = useAccount();
  const formation = useDAOFormation();

  // Form state
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [initialHolder, setInitialHolder] = useState("");

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Derived validation
  const effectiveHolder = initialHolder || walletAddress || "";
  const isValidName = tokenName.length >= 1 && tokenName.length <= 50;
  const isValidSymbol =
    tokenSymbol.length >= 1 &&
    tokenSymbol.length <= 10 &&
    /^[A-Z0-9]+$/.test(tokenSymbol);
  const isValidHolder = isAddress(effectiveHolder);
  const canSubmit =
    isValidName && isValidSymbol && isValidHolder && formation.isSupported;

  // Phase checks
  const isIdle = formation.state.phase === "IDLE";
  const isInFlight =
    formation.state.phase !== "IDLE" &&
    formation.state.phase !== "SUCCESS" &&
    formation.state.phase !== "ERROR";
  const isTerminal =
    formation.state.phase === "SUCCESS" || formation.state.phase === "ERROR";

  const handleSubmit = () => {
    if (!(canSubmit && isIdle)) {
      return;
    }

    formation.startFormation({
      tokenName,
      tokenSymbol,
      initialHolder: effectiveHolder as `0x${string}`,
    });
    setIsDialogOpen(true);
  };

  const handleDialogClose = () => {
    // If in-flight without txHash, allow cancel
    if (isInFlight && !formation.state.daoTxHash) {
      formation.reset();
      setIsDialogOpen(false);
      return;
    }
    // Otherwise just close (keep state for terminal or in-progress with tx)
    setIsDialogOpen(false);
  };

  const handleReset = () => {
    formation.reset();
    setIsDialogOpen(false);
  };

  return (
    <PageContainer maxWidth="lg">
      <SectionCard title="Create DAO">
        {/* Token Name */}
        <div className="space-y-2">
          <label
            className="font-medium text-foreground text-sm"
            htmlFor="tokenName"
          >
            Token Name
          </label>
          <Input
            disabled={!isIdle}
            id="tokenName"
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="e.g., Cogni Governance"
            value={tokenName}
          />
          {tokenName && !isValidName && (
            <p className="text-destructive text-sm">
              Token name must be 1-50 characters
            </p>
          )}
        </div>

        {/* Token Symbol */}
        <div className="space-y-2">
          <label
            className="font-medium text-foreground text-sm"
            htmlFor="tokenSymbol"
          >
            Token Symbol
          </label>
          <Input
            disabled={!isIdle}
            id="tokenSymbol"
            onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
            placeholder="e.g., COGNI"
            value={tokenSymbol}
          />
          {tokenSymbol && !isValidSymbol && (
            <p className="text-destructive text-sm">
              Symbol must be 1-10 uppercase letters/numbers
            </p>
          )}
        </div>

        {/* Initial Holder */}
        <div className="space-y-2">
          <label
            className="font-medium text-foreground text-sm"
            htmlFor="initialHolder"
          >
            Initial Token Holder
          </label>
          <Input
            disabled={!isIdle}
            id="initialHolder"
            onChange={(e) => setInitialHolder(e.target.value)}
            placeholder={walletAddress || "0x..."}
            value={initialHolder}
          />
          <p className="text-muted-foreground text-sm">
            Defaults to your connected wallet if left empty
          </p>
          {initialHolder && !isValidHolder && (
            <p className="text-destructive text-sm">Invalid Ethereum address</p>
          )}
        </div>

        {/* Submit Button */}
        <Button
          className="w-full"
          disabled={!(canSubmit && isIdle)}
          onClick={handleSubmit}
        >
          {isInFlight ? "Creating..." : "Create DAO"}
        </Button>

        {/* Chain Support Warning */}
        {!formation.isSupported && (
          <HintText icon={<Info size={16} />}>
            Please connect to Base or Sepolia to create a DAO
          </HintText>
        )}
      </SectionCard>

      {/* Formation Flow Dialog */}
      <FormationFlowDialog
        addresses={formation.state.addresses}
        daoTxHash={formation.state.daoTxHash}
        errorMessage={formation.state.errorMessage}
        isInFlight={isInFlight}
        isTerminal={isTerminal}
        onClose={handleDialogClose}
        onReset={handleReset}
        open={isDialogOpen}
        phase={formation.state.phase}
        repoSpecYaml={formation.state.repoSpecYaml}
        signalTxHash={formation.state.signalTxHash}
        tokenName={formation.state.config?.tokenName ?? null}
      />
    </PageContainer>
  );
}
