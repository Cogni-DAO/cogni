// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/review/dispatch.server`
 * Purpose: App-layer facade for dispatching PR reviews from webhook payloads.
 * Scope: Resolves bootstrap deps (container, graph executor, adapter factory), delegates to feature handler. Does not contain business logic.
 * Invariants: ARCHITECTURE_ALIGNMENT — facade imports bootstrap, never adapters. Fire-and-forget.
 * Side-effects: IO (async review execution)
 * Links: task.0153
 * @public
 */

import type { Logger } from "pino";

import { getContainer } from "@/bootstrap/container";
import { createGraphExecutor } from "@/bootstrap/graph-executor.factory";
import { createReviewAdapterDeps } from "@/bootstrap/review-adapter.factory";
import { executeStream } from "@/features/ai/public.server";
import { handlePrReview } from "@/features/review/public.server";
import type { ReviewContext } from "@/features/review/types";
import {
  COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  COGNI_SYSTEM_PRINCIPAL_USER_ID,
} from "@/shared/constants/system-tenant";

/** PR actions that trigger review. */
const REVIEW_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

/**
 * Dispatch a PR review from a GitHub pull_request webhook payload.
 * Fire-and-forget: errors are logged, never thrown.
 */
export function dispatchPrReview(
  payload: Record<string, unknown>,
  env: {
    GH_REVIEW_APP_ID?: string | undefined;
    GH_REVIEW_APP_PRIVATE_KEY_BASE64?: string | undefined;
  },
  log: Logger
): void {
  // Filter: only review-triggering actions
  const action = payload.action as string | undefined;
  if (!action || !REVIEW_ACTIONS.has(action)) return;

  // Check credentials are configured
  const appId = env.GH_REVIEW_APP_ID;
  const privateKeyBase64 = env.GH_REVIEW_APP_PRIVATE_KEY_BASE64;
  if (!appId || !privateKeyBase64) {
    log.debug(
      "PR review skipped — GH_REVIEW_APP_ID/PRIVATE_KEY not configured"
    );
    return;
  }

  // Extract context from payload
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const installation = payload.installation as
    | Record<string, unknown>
    | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;

  if (!pr || !installation || !repo) {
    log.warn(
      "PR review skipped — missing pull_request/installation/repository in payload"
    );
    return;
  }

  const head = pr.head as Record<string, unknown>;
  const repoOwner = (repo.owner as Record<string, unknown>)?.login as string;

  const ctx: ReviewContext = {
    owner: repoOwner,
    repo: repo.name as string,
    prNumber: pr.number as number,
    headSha: head.sha as string,
    installationId: installation.id as number,
  };

  // Fire-and-forget async dispatch
  dispatchAsync(ctx, { appId, privateKeyBase64 }, log);
}

/**
 * Resolve system tenant virtual key from DB, then dispatch review.
 * All errors caught and logged.
 */
function dispatchAsync(
  ctx: ReviewContext,
  creds: { appId: string; privateKeyBase64: string },
  log: Logger
): void {
  void (async () => {
    try {
      const container = getContainer();

      // Look up system tenant billing account by known ID
      const billingAccount =
        await container.serviceAccountService.getBillingAccountById(
          COGNI_SYSTEM_BILLING_ACCOUNT_ID
        );

      if (!billingAccount) {
        log.error("PR review failed — system tenant billing account not found");
        return;
      }

      // Create graph executor (same pattern as AI completion facade)
      const executor = createGraphExecutor(
        executeStream,
        COGNI_SYSTEM_PRINCIPAL_USER_ID as ReturnType<
          typeof import("@cogni/ids").toUserId
        >,
        // No preflight credit check for system tenant
        async () => {}
      );

      // Create adapter deps via bootstrap factory (spread flat into handler deps)
      const adapterDeps = createReviewAdapterDeps(
        ctx.installationId,
        creds.appId,
        creds.privateKeyBase64
      );

      await handlePrReview(ctx, {
        executor,
        log,
        virtualKeyId: billingAccount.defaultVirtualKeyId,
        ...adapterDeps,
      });
    } catch (error) {
      log.error(
        { error: String(error), prNumber: ctx.prNumber },
        "PR review dispatch failed"
      );
    }
  })();
}
