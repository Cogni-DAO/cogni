// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/adapters/review-http`
 * Purpose: HTTP client for the operator's internal PR-review GitHub plane.
 * Scope: Worker owns no GitHub credential — every review GitHub call routes to
 *   the operator's `/api/internal/review/*` endpoints. Mirrors run-http.ts.
 * Invariants:
 *   - WORKER_HOLDS_NO_GITHUB_CRED: no Octokit, no App key — only fetch().
 *   - Always targets the operator node (it owns the GitHub App auth).
 *   - Bearer SCHEDULER_API_TOKEN attached to every request.
 *   - Responses are validated against the node-contracts zod schemas.
 *   - 5xx / transient-4xx / network errors rethrow so Temporal retries.
 * Side-effects: IO (HTTP)
 * Links: bug.5000, packages/node-contracts/src/review.internal.v1.contract.ts,
 *   nodes/operator/app/src/app/api/internal/review/*
 * @internal
 */

import type {
  InternalReviewCreateCheckRunOutput,
  InternalReviewPostPrCommentOutput,
  InternalReviewPrContextOutput,
} from "@cogni/node-contracts";
import type { Logger } from "../observability/logger.js";
import { type ReviewHttpClient, RunHttpClientError } from "../ports/index.js";

export interface ReviewHttpAdapterDeps {
  /** COGNI_NODE_ENDPOINTS map — review always resolves the "operator" entry. */
  nodeEndpoints: Map<string, string>;
  schedulerApiToken: string;
  logger: Logger;
}

const RETRYABLE_TRANSIENT_4XX = new Set([404, 408, 409, 429]);
function isRetryableStatus(status: number): boolean {
  if (status >= 500) return true;
  return RETRYABLE_TRANSIENT_4XX.has(status);
}

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function readErrorText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable>";
  }
}

export function createReviewHttpClient(
  deps: ReviewHttpAdapterDeps
): ReviewHttpClient {
  const { nodeEndpoints, schedulerApiToken, logger } = deps;

  /** Review is operator-owned. Resolve the operator base URL at call time. */
  function operatorBase(): string {
    const url = nodeEndpoints.get("operator");
    if (!url) {
      throw new RunHttpClientError(
        'Review HTTP delegation requires an "operator" entry in COGNI_NODE_ENDPOINTS',
        0,
        false
      );
    }
    return url.replace(/\/$/, "");
  }

  async function send(
    method: "POST" | "PATCH",
    path: string,
    body: unknown
  ): Promise<unknown> {
    const url = `${operatorBase()}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: authHeaders(schedulerApiToken),
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new RunHttpClientError(`fetch ${url} failed: ${err}`, 0, true);
    }
    if (!response.ok) {
      const errorText = await readErrorText(response);
      const retryable = isRetryableStatus(response.status);
      logger.error(
        { url, method, status: response.status, errorText, retryable },
        "review.internal request failed"
      );
      throw new RunHttpClientError(
        `${method} ${url} -> ${response.status}: ${errorText}`,
        response.status,
        retryable
      );
    }
    return response.json();
  }

  // Responses are trusted by shape (cast, not re-validated) — same contract-typed
  // delegation pattern as run-http.ts. The operator produced them from its own
  // zod-validated route handlers.
  return {
    async createCheckRun(input) {
      const json = (await send(
        "POST",
        "/api/internal/review/check-runs",
        input
      )) as InternalReviewCreateCheckRunOutput;
      return json.checkRunId;
    },

    async updateCheckRun(input) {
      await send("PATCH", "/api/internal/review/check-runs", input);
    },

    async postPrComment(input) {
      return (await send(
        "POST",
        "/api/internal/review/pr-comments",
        input
      )) as InternalReviewPostPrCommentOutput;
    },

    async fetchPrContext(input) {
      return (await send(
        "POST",
        "/api/internal/review/pr-context",
        input
      )) as InternalReviewPrContextOutput;
    },
  };
}
