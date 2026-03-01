// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/gov/review/view`
 * Purpose: Client component for epoch review admin page — review contributions, adjust weights via subject overrides, sign & finalize.
 * Scope: Composition of EpochDetail + useSignEpoch + useReviewEpochs + useSubjectOverrides. Does not perform server-side logic or direct DB access.
 * Invariants: WRITE_ROUTES_APPROVER_GATED (UI gate via isApprover prop, server enforces). BigInt units displayed via Number() for presentation only.
 * Side-effects: IO (via hooks — subject-overrides CRUD, sign-data, finalize)
 * Links: src/features/governance/types.ts, work/items/task.0119.epoch-signer-ui.md
 * @public
 */

"use client";

import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  Eye,
  FileSignature,
  GitCommit,
  GitPullRequest,
  Loader2,
  Lock,
  MessageCircle,
  MessageSquare,
  Pencil,
  Pin,
  RotateCcw,
  Save,
  ThumbsUp,
  X,
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useState } from "react";
import { Badge, Button, Input } from "@/components";
import { EpochDetail } from "@/features/governance/components/EpochDetail";
import { SourceBadge } from "@/features/governance/components/SourceBadge";
import { useReviewEpochs } from "@/features/governance/hooks/useReviewEpochs";
import { useSignEpoch } from "@/features/governance/hooks/useSignEpoch";
import {
  type SubjectOverrideView,
  useSubjectOverrides,
} from "@/features/governance/hooks/useSubjectOverrides";
import type {
  EpochContributor,
  EpochView,
  IngestionReceipt,
} from "@/features/governance/types";

interface ReviewViewProps {
  readonly isApprover: boolean;
}

export function ReviewView({ isApprover }: ReviewViewProps): ReactElement {
  const { data: reviewEpochs, isLoading, error } = useReviewEpochs();

  if (!isApprover) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border bg-card p-12 text-center">
        <Lock className="h-10 w-10 text-muted-foreground" />
        <div>
          <h2 className="font-semibold text-lg">Not Authorized</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Only ledger approvers can access the epoch review page. Connect an
            approver wallet via SIWE to proceed.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
        <h2 className="font-semibold text-destructive text-lg">
          Error loading review data
        </h2>
        <p className="text-muted-foreground text-sm">
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (isLoading || !reviewEpochs) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-64 rounded-md bg-muted" />
        <div className="h-64 rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 font-bold text-3xl tracking-tight">Epoch Review</h1>
        <p className="text-muted-foreground text-sm">
          Review contributions, adjust weights, and sign to finalize.
        </p>
      </div>

      {reviewEpochs.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">
            No epochs currently in review.
          </p>
          <p className="mt-2 text-muted-foreground text-sm">
            Epochs will appear here when they transition from open to review.
          </p>
        </div>
      ) : (
        reviewEpochs.map((epoch) => (
          <ReviewEpochSection key={epoch.id} epoch={epoch} />
        ))
      )}
    </div>
  );
}

// ── Per-epoch review section ─────────────────────────────────────────────────

function ReviewEpochSection({
  epoch,
}: {
  readonly epoch: EpochView;
}): ReactElement {
  const { state, sign, reset } = useSignEpoch(epoch.id);
  const overrides = useSubjectOverrides(epoch.id);

  const handleSign = useCallback(() => {
    void sign();
  }, [sign]);

  const renderExpandedContent = useCallback(
    (contributor: EpochContributor): ReactElement | null => {
      if (contributor.receipts.length === 0) return null;
      return (
        <div className="space-y-1">
          {contributor.receipts.map((receipt) => (
            <ReviewReceiptRow
              key={receipt.receiptId}
              receipt={receipt}
              override={overrides.overridesByRef.get(receipt.receiptId) ?? null}
              onSave={overrides.saveOverride}
              onRemove={overrides.removeOverride}
              isSaving={overrides.isSaving}
            />
          ))}
        </div>
      );
    },
    [overrides]
  );

  const activeOverrideCount = overrides.overridesByRef.size;

  return (
    <div className="space-y-4">
      {activeOverrideCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
          <Pencil className="h-3.5 w-3.5 text-warning" />
          <span className="text-warning">
            {activeOverrideCount} active weight{" "}
            {activeOverrideCount === 1 ? "override" : "overrides"}
          </span>
          <span className="text-muted-foreground">
            — expand contributions to view or edit
          </span>
        </div>
      )}

      <EpochDetail
        epoch={epoch}
        renderExpandedContent={renderExpandedContent}
      />

      {/* Sign & Finalize action */}
      <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
        {state.phase === "IDLE" && (
          <Button onClick={handleSign}>
            <FileSignature className="mr-2 h-4 w-4" />
            Sign & Finalize
          </Button>
        )}

        {state.isInFlight && (
          <Button disabled>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {state.phase === "FETCHING_DATA" && "Preparing..."}
            {state.phase === "AWAITING_SIGNATURE" && "Awaiting wallet..."}
            {state.phase === "SUBMITTING" && "Submitting..."}
          </Button>
        )}

        {state.phase === "SUCCESS" && (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            <span>Finalization started (workflow: {state.workflowId})</span>
          </div>
        )}

        {state.phase === "ERROR" && (
          <div className="flex items-center gap-3">
            <div className="text-destructive text-sm">{state.errorMessage}</div>
            <Button variant="outline" size="sm" onClick={reset}>
              Try Again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Receipt row with inline override editing ────────────────────────────────

const TYPE_ICONS: Record<string, LucideIcon> = {
  pr_merged: GitPullRequest,
  commit_pushed: GitCommit,
  review_submitted: Eye,
  comment_created: MessageCircle,
  message_sent: MessageSquare,
  reaction_added: ThumbsUp,
};

const TYPE_LABELS: Record<string, string> = {
  pr_merged: "PR",
  commit_pushed: "Commit",
  review_submitted: "Review",
  comment_created: "Comment",
  message_sent: "Message",
  reaction_added: "Reaction",
};

function ReceiptInfo({
  receipt,
}: {
  readonly receipt: IngestionReceipt;
}): ReactElement {
  const Icon = TYPE_ICONS[receipt.eventType] ?? Pin;
  const score = receipt.units ? Math.round(Number(receipt.units) / 1000) : null;
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <SourceBadge source={receipt.source as "github" | "discord"} />
      <span className="text-muted-foreground text-xs">
        {TYPE_LABELS[receipt.eventType] ?? receipt.eventType}
      </span>
      {score != null && (
        <span className="font-mono text-muted-foreground text-xs">{score}</span>
      )}
    </div>
  );
}

function ReviewReceiptRow({
  receipt,
  override,
  onSave,
  onRemove,
  isSaving,
}: {
  readonly receipt: IngestionReceipt;
  readonly override: SubjectOverrideView | null;
  readonly onSave: (
    subjectRef: string,
    overrideUnits: string,
    reason?: string
  ) => Promise<void>;
  readonly onRemove: (subjectRef: string) => Promise<void>;
  readonly isSaving: boolean;
}): ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const [editUnits, setEditUnits] = useState(override?.overrideUnits ?? "");
  const [editReason, setEditReason] = useState(override?.overrideReason ?? "");

  const handleStartEdit = useCallback(() => {
    setEditUnits(override?.overrideUnits ?? "");
    setEditReason(override?.overrideReason ?? "");
    setIsEditing(true);
  }, [override]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editUnits.trim() || !/^\d+$/.test(editUnits.trim())) return;
    await onSave(
      receipt.receiptId,
      editUnits.trim(),
      editReason.trim() || undefined
    );
    setIsEditing(false);
  }, [receipt.receiptId, editUnits, editReason, onSave]);

  const handleRemove = useCallback(async () => {
    await onRemove(receipt.receiptId);
  }, [receipt.receiptId, onRemove]);

  const hasOverride = override !== null;

  if (isEditing) {
    return (
      <div className="space-y-2 rounded border border-primary/20 bg-primary/5 p-2">
        <ReceiptInfo receipt={receipt} />
        <div className="flex items-end gap-2 pl-1">
          <div className="flex-1">
            <label
              htmlFor={`override-units-${receipt.receiptId}`}
              className="mb-1 block text-muted-foreground text-xs"
            >
              Override weight (units)
            </label>
            <Input
              id={`override-units-${receipt.receiptId}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={editUnits}
              onChange={(e) => setEditUnits(e.target.value)}
              placeholder="e.g. 500"
              className="h-7 text-xs"
            />
          </div>
          <div className="flex-2">
            <label
              htmlFor={`override-reason-${receipt.receiptId}`}
              className="mb-1 block text-muted-foreground text-xs"
            >
              Reason (optional)
            </label>
            <Input
              id={`override-reason-${receipt.receiptId}`}
              type="text"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="e.g. trivial fix"
              className="h-7 text-xs"
            />
          </div>
          <Button
            size="sm"
            className="h-7 px-2"
            onClick={() => void handleSave()}
            disabled={
              isSaving || !editUnits.trim() || !/^\d+$/.test(editUnits.trim())
            }
          >
            <Save className="mr-1 h-3 w-3" />
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            onClick={handleCancel}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        hasOverride
          ? "flex items-center justify-between rounded border border-warning/20 bg-warning/5 px-2 py-1"
          : "flex items-center justify-between rounded bg-secondary/30 px-2 py-1"
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <ReceiptInfo receipt={receipt} />
        {hasOverride && (
          <Badge intent="secondary" size="sm" className="h-5 shrink-0 px-1.5">
            {override.overrideUnits} units
            {override.overrideReason ? ` — ${override.overrideReason}` : ""}
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5"
          onClick={handleStartEdit}
          title="Adjust weight"
        >
          <Pencil className="h-3 w-3" />
        </Button>
        {hasOverride && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-muted-foreground hover:text-destructive"
            onClick={() => void handleRemove()}
            disabled={isSaving}
            title="Reset to original"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
