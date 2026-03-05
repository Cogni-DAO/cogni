// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `scheduler-worker/adapters/ingestion/github-webhook`
 * Purpose: Unit tests for GitHubWebhookNormalizer — verify() signature validation and normalize() payload parsing.
 * Scope: Covers pull_request (merged, non-closed, unmerged, bot), issues (closed, non-closed, bot), unsupported events, supportedEvents list. Does NOT test HTTP transport or feature service integration.
 * Invariants: WEBHOOK_VERIFY_VIA_OSS (uses @octokit/webhooks-methods for real HMAC-SHA256 signing in fixtures)
 * Side-effects: none
 * Links: services/scheduler-worker/src/adapters/ingestion/github-webhook.ts
 * @public
 */

import { sign } from "@octokit/webhooks-methods";
import { describe, expect, it } from "vitest";

import { GitHubWebhookNormalizer } from "../src/adapters/ingestion/github-webhook";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "test-webhook-secret";

function makeHeaders(
  event: string,
  _body: string,
  signature?: string
): Record<string, string> {
  const h: Record<string, string> = { "x-github-event": event };
  if (signature) h["x-hub-signature-256"] = signature;
  return h;
}

async function signPayload(body: string): Promise<string> {
  return sign(SECRET, body);
}

function makePrPayload(overrides?: Record<string, unknown>) {
  return {
    action: "closed",
    pull_request: {
      number: 42,
      merged: true,
      merged_at: "2026-01-15T10:30:00Z",
      title: "Add feature X",
      html_url: "https://github.com/test/repo/pull/42",
      additions: 100,
      deletions: 20,
      changed_files: 5,
      user: { id: 12345, login: "testuser", type: "User" },
    },
    repository: { full_name: "test/repo" },
    ...overrides,
  };
}

function makeIssuePayload(overrides?: Record<string, unknown>) {
  return {
    action: "closed",
    issue: {
      number: 7,
      closed_at: "2026-01-15T11:00:00Z",
      title: "Fix bug Y",
      html_url: "https://github.com/test/repo/issues/7",
      user: { id: 67890, login: "issueuser", type: "User" },
    },
    repository: { full_name: "test/repo" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitHubWebhookNormalizer", () => {
  const normalizer = new GitHubWebhookNormalizer();

  // -----------------------------------------------------------------------
  // verify()
  // -----------------------------------------------------------------------

  describe("verify()", () => {
    it("returns true for valid signature", async () => {
      const body = JSON.stringify(makePrPayload());
      const sig = await signPayload(body);
      const headers = makeHeaders("pull_request", body, sig);

      const result = await normalizer.verify(
        headers,
        Buffer.from(body),
        SECRET
      );
      expect(result).toBe(true);
    });

    it("returns false for invalid signature", async () => {
      const body = JSON.stringify(makePrPayload());
      const headers = makeHeaders("pull_request", body, "sha256=invalid");

      const result = await normalizer.verify(
        headers,
        Buffer.from(body),
        SECRET
      );
      expect(result).toBe(false);
    });

    it("returns false when signature header is missing", async () => {
      const body = JSON.stringify(makePrPayload());
      const headers = makeHeaders("pull_request", body);

      const result = await normalizer.verify(
        headers,
        Buffer.from(body),
        SECRET
      );
      expect(result).toBe(false);
    });

    it("returns false when body has been tampered", async () => {
      const body = JSON.stringify(makePrPayload());
      const sig = await signPayload(body);
      const headers = makeHeaders("pull_request", body, sig);
      const tampered = JSON.stringify({ ...makePrPayload(), action: "opened" });

      const result = await normalizer.verify(
        headers,
        Buffer.from(tampered),
        SECRET
      );
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // normalize() — pull_request
  // -----------------------------------------------------------------------

  describe("normalize() — pull_request", () => {
    it("produces event for merged PR", async () => {
      const payload = makePrPayload();
      const headers = makeHeaders("pull_request", "");

      const events = await normalizer.normalize(headers, payload);
      expect(events).toHaveLength(1);

      const e = events[0];
      expect(e.id).toBe("github:pr:test/repo:42");
      expect(e.source).toBe("github");
      expect(e.eventType).toBe("pr_merged");
      expect(e.platformUserId).toBe("12345");
      expect(e.platformLogin).toBe("testuser");
      expect(e.artifactUrl).toBe("https://github.com/test/repo/pull/42");
      expect(e.payloadHash).toBeTruthy();
      expect(e.eventTime).toEqual(new Date("2026-01-15T10:30:00Z"));
      expect(e.metadata).toMatchObject({
        title: "Add feature X",
        repo: "test/repo",
        additions: 100,
        deletions: 20,
        changedFiles: 5,
      });
    });

    it("skips non-closed PR actions", async () => {
      const payload = makePrPayload({ action: "opened" });
      const headers = makeHeaders("pull_request", "");

      const events = await normalizer.normalize(headers, payload);
      expect(events).toHaveLength(0);
    });

    it("skips unmerged closed PRs", async () => {
      const payload = makePrPayload();
      (payload.pull_request as Record<string, unknown>).merged = false;
      const headers = makeHeaders("pull_request", "");

      const events = await normalizer.normalize(headers, payload);
      expect(events).toHaveLength(0);
    });

    it("skips bot authors", async () => {
      const payload = makePrPayload();
      (payload.pull_request as Record<string, unknown>).user = {
        id: 99,
        login: "dependabot[bot]",
        type: "Bot",
      };
      const headers = makeHeaders("pull_request", "");

      const events = await normalizer.normalize(headers, payload);
      expect(events).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // normalize() — issues
  // -----------------------------------------------------------------------

  describe("normalize() — issues", () => {
    it("produces event for closed issue", async () => {
      const payload = makeIssuePayload();
      const headers = makeHeaders("issues", "");

      const events = await normalizer.normalize(headers, payload);
      expect(events).toHaveLength(1);

      const e = events[0];
      expect(e.id).toBe("github:issue:test/repo:7");
      expect(e.source).toBe("github");
      expect(e.eventType).toBe("issue_closed");
      expect(e.platformUserId).toBe("67890");
      expect(e.platformLogin).toBe("issueuser");
      expect(e.payloadHash).toBeTruthy();
      expect(e.eventTime).toEqual(new Date("2026-01-15T11:00:00Z"));
    });

    it("skips non-closed issue actions", async () => {
      const payload = makeIssuePayload({ action: "opened" });
      const headers = makeHeaders("issues", "");

      const events = await normalizer.normalize(headers, payload);
      expect(events).toHaveLength(0);
    });

    it("skips bot authors on issues", async () => {
      const payload = makeIssuePayload();
      (payload.issue as Record<string, unknown>).user = {
        id: 99,
        login: "bot",
        type: "Bot",
      };
      const headers = makeHeaders("issues", "");

      const events = await normalizer.normalize(headers, payload);
      expect(events).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // normalize() — unsupported events
  // -----------------------------------------------------------------------

  describe("normalize() — unsupported events", () => {
    it("returns empty array for unknown event types", async () => {
      const headers = makeHeaders("push", "");
      const events = await normalizer.normalize(headers, { ref: "main" });
      expect(events).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // supportedEvents
  // -----------------------------------------------------------------------

  describe("supportedEvents", () => {
    it("lists pull_request and issues", () => {
      expect(normalizer.supportedEvents).toContain("pull_request");
      expect(normalizer.supportedEvents).toContain("issues");
    });
  });
});
