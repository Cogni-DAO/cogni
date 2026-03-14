// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/broadcasting/_api/broadcasts`
 * Purpose: Client-side fetch wrappers for broadcasting API endpoints.
 * Scope: Typed fetch functions for list, create, status, and review. Does not implement business logic.
 * Invariants: CONTRACTS_ARE_TRUTH — all types via z.infer from contract files.
 * Side-effects: IO
 * Links: broadcast.draft.v1.contract, broadcast.status.v1.contract, broadcast.review.v1.contract
 * @internal
 */

import type {
  BroadcastDraftInput,
  ContentMessageListResponse,
  ContentMessageResponse,
} from "@/contracts/broadcast.draft.v1.contract";
import type {
  BroadcastReviewInput,
  PlatformPostResponse,
} from "@/contracts/broadcast.review.v1.contract";
import type { BroadcastStatusResponse } from "@/contracts/broadcast.status.v1.contract";

export async function fetchBroadcasts(
  status?: string
): Promise<ContentMessageListResponse> {
  const url = status
    ? `/api/v1/broadcasting?status=${encodeURIComponent(status)}`
    : "/api/v1/broadcasting";

  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Failed to fetch broadcasts",
    }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function createDraft(
  input: BroadcastDraftInput
): Promise<ContentMessageResponse> {
  const response = await fetch("/api/v1/broadcasting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Failed to create draft",
    }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function fetchBroadcastStatus(
  messageId: string
): Promise<BroadcastStatusResponse> {
  const response = await fetch(
    `/api/v1/broadcasting/${encodeURIComponent(messageId)}`,
    {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Failed to fetch broadcast status",
    }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function submitReview(
  messageId: string,
  postId: string,
  input: BroadcastReviewInput
): Promise<PlatformPostResponse> {
  const response = await fetch(
    `/api/v1/broadcasting/${encodeURIComponent(messageId)}/posts/${encodeURIComponent(postId)}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(input),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Failed to submit review",
    }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}
