// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ingestion/github-webhook`
 * Purpose: GitHub webhook normalizer — verifies signature and normalizes webhook payloads to ActivityEvent[].
 * Scope: Implements WebhookNormalizer from @cogni/ingestion-core. Uses @octokit/webhooks-methods for HMAC-SHA256 verification. Does not perform HTTP I/O or hold mutable state.
 * Invariants:
 * - WEBHOOK_VERIFY_VIA_OSS: Signature verification via @octokit/webhooks-methods (not bespoke crypto)
 * - WEBHOOK_VERIFY_BEFORE_NORMALIZE: verify() must be called before normalize() — enforced by feature service
 * - ACTIVITY_IDEMPOTENT: Deterministic event IDs from source data (same as poll adapter)
 * Side-effects: none
 * Links: docs/spec/attribution-ledger.md
 * @internal
 */

import type { ActivityEvent, WebhookNormalizer } from "@cogni/ingestion-core";
import { buildEventId, hashCanonicalPayload } from "@cogni/ingestion-core";
import { verify } from "@octokit/webhooks-methods";

/** Shared version for all GitHub data source registrations (poll + webhook). */
export const GITHUB_ADAPTER_VERSION = "0.3.0" as const;

/**
 * GitHub webhook normalizer.
 * Handles pull_request (merged) and issues (closed) webhook events.
 * Uses @octokit/webhooks-methods for HMAC-SHA256 signature verification.
 */
export class GitHubWebhookNormalizer implements WebhookNormalizer {
  readonly supportedEvents = [
    "pull_request",
    "issues",
  ] as const satisfies readonly string[];

  async verify(
    headers: Record<string, string>,
    body: Buffer,
    secret: string
  ): Promise<boolean> {
    const signature = headers["x-hub-signature-256"];
    if (!signature) return false;

    try {
      return await verify(secret, body.toString("utf-8"), signature);
    } catch {
      return false;
    }
  }

  async normalize(
    headers: Record<string, string>,
    body: unknown
  ): Promise<ActivityEvent[]> {
    const eventType = headers["x-github-event"];
    const payload = body as Record<string, unknown>;

    switch (eventType) {
      case "pull_request":
        return this.normalizePullRequest(payload);
      case "issues":
        return this.normalizeIssue(payload);
      default:
        return [];
    }
  }

  // -------------------------------------------------------------------------
  // Private: Pull Request (merged)
  // -------------------------------------------------------------------------

  private async normalizePullRequest(
    payload: Record<string, unknown>
  ): Promise<ActivityEvent[]> {
    if (payload.action !== "closed") return [];

    const pr = payload.pull_request as Record<string, unknown> | undefined;
    if (!pr?.merged) return [];

    const repo = payload.repository as Record<string, unknown> | undefined;
    const fullName = repo?.full_name as string | undefined;
    if (!fullName) return [];

    const prNumber = pr.number as number;
    const mergedAt = pr.merged_at as string;

    const author = pr.user as Record<string, unknown> | undefined;
    if (!author) return [];

    const authorType = author.type as string;
    if (authorType !== "User") return [];

    const authorId = String(author.id as number);
    const authorLogin = author.login as string;

    const id = buildEventId("github", "pr", fullName, prNumber);
    const payloadHash = await hashCanonicalPayload({
      authorId,
      id,
      mergedAt,
    });

    return [
      {
        id,
        source: "github",
        eventType: "pr_merged",
        platformUserId: authorId,
        platformLogin: authorLogin,
        artifactUrl: pr.html_url as string,
        metadata: {
          title: pr.title as string,
          repo: fullName,
          additions: pr.additions as number,
          deletions: pr.deletions as number,
          changedFiles: pr.changed_files as number,
        },
        payloadHash,
        eventTime: new Date(mergedAt),
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Private: Issue (closed)
  // -------------------------------------------------------------------------

  private async normalizeIssue(
    payload: Record<string, unknown>
  ): Promise<ActivityEvent[]> {
    if (payload.action !== "closed") return [];

    const issue = payload.issue as Record<string, unknown> | undefined;
    if (!issue) return [];

    const repo = payload.repository as Record<string, unknown> | undefined;
    const fullName = repo?.full_name as string | undefined;
    if (!fullName) return [];

    const issueNumber = issue.number as number;
    const closedAt = issue.closed_at as string;
    if (!closedAt) return [];

    const author = issue.user as Record<string, unknown> | undefined;
    if (!author) return [];

    const authorType = author.type as string;
    if (authorType !== "User") return [];

    const authorId = String(author.id as number);
    const authorLogin = author.login as string;

    const id = buildEventId("github", "issue", fullName, issueNumber);
    const payloadHash = await hashCanonicalPayload({
      authorId,
      closedAt,
      id,
    });

    return [
      {
        id,
        source: "github",
        eventType: "issue_closed",
        platformUserId: authorId,
        platformLogin: authorLogin,
        artifactUrl: issue.html_url as string,
        metadata: {
          title: issue.title as string,
          repo: fullName,
        },
        payloadHash,
        eventTime: new Date(closedAt),
      },
    ];
  }
}
