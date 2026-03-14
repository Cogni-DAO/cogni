// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/broadcasting/view`
 * Purpose: Client-side broadcasting dashboard — list messages, compose drafts, expand detail, review posts.
 * Scope: Presentation + URL-driven filter state. Fetches data via React Query.
 * Invariants: MESSAGE_IS_PLATFORM_AGNOSTIC, REVIEW_BEFORE_HIGH_RISK, CONTRACTS_ARE_TRUTH, KIT_IS_ONLY_API
 * Side-effects: IO (fetches from /api/v1/broadcasting)
 * Links: [BroadcastingPage](./page.tsx), [broadcasts](./_api/broadcasts.ts)
 * @public
 */

"use client";

import { CONTENT_MESSAGE_STATUSES, PLATFORM_IDS } from "@cogni/broadcast-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  ExpandableTableRow,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components";
import type {
  BroadcastDraftInput,
  ContentMessageResponse,
} from "@/contracts/broadcast.draft.v1.contract";
import type { PlatformPostResponse } from "@/contracts/broadcast.review.v1.contract";
import type { BroadcastStatusResponse } from "@/contracts/broadcast.status.v1.contract";

import {
  createDraft,
  fetchBroadcastStatus,
  fetchBroadcasts,
  submitReview,
} from "./_api/broadcasts";

// ── Status / Risk badge helpers ─────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  optimizing: "bg-warning/15 text-warning",
  review: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  publishing: "bg-primary/15 text-primary-foreground",
  published: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  cancelled: "bg-muted text-muted-foreground",
  // platform post statuses
  pending_optimization: "bg-muted text-muted-foreground",
  optimized: "bg-primary/15 text-primary-foreground",
  pending_review: "bg-warning/15 text-warning",
  rejected: "bg-danger/15 text-danger",
};

const RISK_STYLE: Record<string, string> = {
  low: "bg-success/15 text-success",
  medium: "bg-warning/15 text-warning",
  high: "bg-danger/15 text-danger",
};

function StatusBadge({ status }: { status: string }): ReactElement {
  return (
    <Badge
      intent="outline"
      size="sm"
      className={STATUS_STYLE[status] ?? "bg-muted text-muted-foreground"}
    >
      {status}
    </Badge>
  );
}

function RiskBadge({ level }: { level: string | null }): ReactElement | null {
  if (!level) return null;
  return (
    <Badge
      intent="outline"
      size="sm"
      className={RISK_STYLE[level] ?? "bg-muted text-muted-foreground"}
    >
      {level} risk
    </Badge>
  );
}

// ── Detail / Review (lazy-loaded inside ExpandableTableRow) ─────

function MessageDetail({ messageId }: { messageId: string }): ReactElement {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<BroadcastStatusResponse>({
    queryKey: ["broadcast-status", messageId],
    queryFn: () => fetchBroadcastStatus(messageId),
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      postId,
      decision,
      editedBody,
    }: {
      postId: string;
      decision: "approved" | "rejected" | "edited";
      editedBody?: string;
    }) => submitReview(messageId, postId, { decision, editedBody }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["broadcast-status", messageId],
      });
      void queryClient.invalidateQueries({ queryKey: ["broadcasts"] });
    },
  });

  if (isLoading) {
    return (
      <p className="py-4 text-center text-muted-foreground text-sm">
        Loading posts...
      </p>
    );
  }
  if (error) {
    return (
      <p className="py-4 text-center text-danger text-sm">
        Failed to load posts.
      </p>
    );
  }

  const posts = data?.posts ?? [];

  if (posts.length === 0) {
    return (
      <p className="py-4 text-center text-muted-foreground text-sm">
        No platform posts yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {posts.map((post: PlatformPostResponse) => (
        <PostCard
          key={post.id}
          post={post}
          onReview={(decision, editedBody) =>
            reviewMutation.mutate({
              postId: post.id,
              decision,
              ...(editedBody != null ? { editedBody } : {}),
            })
          }
          isReviewing={reviewMutation.isPending}
        />
      ))}
    </div>
  );
}

function PostCard({
  post,
  onReview,
  isReviewing,
}: {
  post: PlatformPostResponse;
  onReview: (
    decision: "approved" | "rejected" | "edited",
    editedBody?: string
  ) => void;
  isReviewing: boolean;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(post.optimizedBody);

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <Badge intent="outline" size="sm">
          {post.platform}
        </Badge>
        <StatusBadge status={post.status} />
        <RiskBadge level={post.riskLevel} />
        {post.reviewDecision && (
          <span className="text-muted-foreground text-xs">
            reviewed: {post.reviewDecision}
          </span>
        )}
      </div>

      <p className="mb-2 whitespace-pre-wrap text-muted-foreground text-xs">
        {post.optimizedBody}
      </p>

      {post.externalUrl && (
        <a
          href={post.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary text-xs underline"
        >
          View on {post.platform}
        </a>
      )}

      {post.errorMessage && (
        <p className="text-danger text-xs">Error: {post.errorMessage}</p>
      )}

      {post.status === "pending_review" && (
        <div className="mt-3 space-y-2">
          {editing ? (
            <>
              <textarea
                className="w-full rounded-md border bg-background p-2 text-sm"
                rows={4}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    onReview("edited", editBody);
                    setEditing(false);
                  }}
                  disabled={isReviewing}
                >
                  Submit Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(false);
                    setEditBody(post.optimizedBody);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => onReview("approved")}
                disabled={isReviewing}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onReview("rejected")}
                disabled={isReviewing}
              >
                Reject
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Compose Dialog ──────────────────────────────────────────────

function ComposeDialog(): ReactElement {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: (input: BroadcastDraftInput) => createDraft(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["broadcasts"] });
      setOpen(false);
      setBody("");
      setTitle("");
      setPlatforms([]);
    },
  });

  const handleSubmit = () => {
    if (!body.trim() || platforms.length === 0) return;
    mutation.mutate({
      body: body.trim(),
      title: title.trim() || undefined,
      targetPlatforms: platforms as BroadcastDraftInput["targetPlatforms"],
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          New Draft
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Compose Broadcast</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="broadcast-body"
              className="mb-1 block font-medium text-sm"
            >
              Body
            </label>
            <textarea
              id="broadcast-body"
              className="w-full rounded-md border bg-background p-2 text-sm"
              rows={6}
              placeholder="What do you want to say?"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div>
            <label
              htmlFor="broadcast-title"
              className="mb-1 block font-medium text-sm"
            >
              Title (optional)
            </label>
            <Input
              id="broadcast-title"
              placeholder="For blog posts or long-form content"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <span className="mb-1 block font-medium text-sm">
              Target Platforms
            </span>
            <ToggleGroup
              type="multiple"
              value={platforms}
              onValueChange={setPlatforms}
              className="flex-wrap justify-start"
            >
              {PLATFORM_IDS.map((pid) => (
                <ToggleGroupItem key={pid} value={pid} size="sm">
                  {pid}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>

        {mutation.error && (
          <p className="text-danger text-sm">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "Failed to create draft"}
          </p>
        )}

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? "Creating..." : "Create Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main View ───────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function BroadcastingView(): ReactElement {
  const [statusFilter, setStatusFilter] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["broadcasts", statusFilter],
    queryFn: () => fetchBroadcasts(statusFilter || undefined),
    staleTime: 30_000,
  });

  const messages = data?.messages ?? [];

  return (
    <div className="flex flex-col gap-6 p-5 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-xl tracking-tight md:text-2xl">
          Broadcasting
        </h1>
        <ComposeDialog />
      </div>

      {/* Status filter */}
      <div className="flex gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {CONTENT_MESSAGE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading / Error */}
      {isLoading && (
        <p className="py-8 text-center text-muted-foreground">
          Loading broadcasts...
        </p>
      )}
      {error && (
        <p className="py-8 text-center text-danger">
          Failed to load broadcasts.
        </p>
      )}

      {/* Table */}
      {!isLoading && !error && (
        <div className="-mx-5 overflow-x-auto border-t border-b md:mx-0 md:rounded-md md:border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Body</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-36">Platforms</TableHead>
                <TableHead className="w-28">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No broadcasts yet. Create your first draft above.
                  </TableCell>
                </TableRow>
              ) : (
                messages.map((msg: ContentMessageResponse) => (
                  <ExpandableTableRow
                    key={msg.id}
                    colSpan={5}
                    cells={[
                      <span key="body" className="text-sm">
                        {truncate(msg.body, 80)}
                      </span>,
                      <StatusBadge key="status" status={msg.status} />,
                      <span
                        key="platforms"
                        className="text-muted-foreground text-xs"
                      >
                        {msg.targetPlatforms.join(", ")}
                      </span>,
                      <span
                        key="date"
                        className="text-muted-foreground text-xs"
                      >
                        {new Date(msg.createdAt).toLocaleDateString()}
                      </span>,
                    ]}
                    expandedContent={<MessageDetail messageId={msg.id} />}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
