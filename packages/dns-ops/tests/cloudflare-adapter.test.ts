// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/dns-ops/tests/cloudflare-adapter`
 * Purpose: Unit tests for CloudflareAdapter — mocked fetch, JSON response parsing.
 * Scope: Tests all Cloudflare API operations including error handling. Does NOT make real HTTP calls.
 * Invariants: Tests must not make real HTTP calls.
 * Side-effects: none
 * Links: packages/dns-ops/src/adapters/cloudflare.adapter.ts
 * @internal
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareAdapter } from "../src/index.js";

// ── JSON response fixtures ──────────────────────────────────

const LIST_RECORDS_RESPONSE = {
  success: true,
  result: [
    {
      id: "rec-1",
      type: "A",
      name: "cognidao.org",
      content: "1.2.3.4",
      ttl: 1,
      proxied: false,
    },
    {
      id: "rec-2",
      type: "CNAME",
      name: "www.cognidao.org",
      content: "cognidao.org",
      ttl: 1,
      proxied: true,
    },
  ],
  result_info: {
    page: 1,
    per_page: 100,
    total_pages: 1,
    count: 2,
    total_count: 2,
  },
};

const CREATE_RECORD_RESPONSE = {
  success: true,
  result: {
    id: "rec-new",
    type: "CNAME",
    name: "pr-42.preview.cognidao.org",
    content: "deploy-abc.vercel.app",
    ttl: 300,
    proxied: false,
  },
};

const FIND_EMPTY_RESPONSE = {
  success: true,
  result: [],
  result_info: {
    page: 1,
    per_page: 100,
    total_pages: 1,
    count: 0,
    total_count: 0,
  },
};

const FIND_EXISTING_RESPONSE = {
  success: true,
  result: [
    {
      id: "rec-existing",
      type: "CNAME",
      name: "pr-42.preview.cognidao.org",
      content: "old-deploy.vercel.app",
      ttl: 300,
      proxied: false,
    },
  ],
  result_info: {
    page: 1,
    per_page: 100,
    total_pages: 1,
    count: 1,
    total_count: 1,
  },
};

const UPDATE_RECORD_RESPONSE = {
  success: true,
  result: {
    id: "rec-existing",
    type: "CNAME",
    name: "pr-42.preview.cognidao.org",
    content: "new-deploy.vercel.app",
    ttl: 300,
    proxied: false,
  },
};

const DELETE_RESPONSE = { success: true, result: { id: "rec-existing" } };

const ERROR_RESPONSE = {
  success: false,
  errors: [
    { code: 7003, message: "Could not route to /zones/bad/dns_records" },
  ],
};

// ── Tests ───────────────────────────────────────────────────

describe("CloudflareAdapter", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  function mockFetchSequence(...responses: object[]) {
    const queue = [...responses];
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const body = queue.shift() ?? { success: true, result: {} };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  }

  function mockFetch(json: object) {
    mockFetchSequence(json);
  }

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  const adapter = new CloudflareAdapter({
    apiToken: "test-cf-token",
    zoneId: "zone-123",
  });

  describe("getDnsRecords", () => {
    it("parses records from Cloudflare response", async () => {
      mockFetch(LIST_RECORDS_RESPONSE);

      const records = await adapter.getDnsRecords("cognidao", "org");

      expect(records).toEqual([
        {
          id: "rec-1",
          name: "cognidao.org",
          type: "A",
          value: "1.2.3.4",
          ttl: 1,
          proxied: false,
          mxPref: undefined,
        },
        {
          id: "rec-2",
          name: "www.cognidao.org",
          type: "CNAME",
          value: "cognidao.org",
          ttl: 1,
          proxied: true,
          mxPref: undefined,
        },
      ]);

      // Verify auth header
      const [url, init] = fetchSpy.mock.calls.at(0) ?? [];
      expect(url).toContain("/zones/zone-123/dns_records");
      expect((init as RequestInit).headers).toHaveProperty(
        "Authorization",
        "Bearer test-cf-token"
      );
    });
  });

  describe("createRecord", () => {
    it("creates a CNAME record", async () => {
      mockFetch(CREATE_RECORD_RESPONSE);

      const result = await adapter.createRecord(
        {
          name: "pr-42.preview",
          type: "CNAME",
          value: "deploy-abc.vercel.app",
          ttl: 300,
        },
        "cognidao.org"
      );

      expect(result.id).toBe("rec-new");
      expect(result.value).toBe("deploy-abc.vercel.app");

      const [, init] = fetchSpy.mock.calls.at(0) ?? [];
      expect((init as RequestInit).method).toBe("POST");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.name).toBe("pr-42.preview");
      expect(body.type).toBe("CNAME");
      expect(body.content).toBe("deploy-abc.vercel.app");
    });
  });

  describe("findRecords", () => {
    it("finds records by name and type", async () => {
      mockFetch(FIND_EXISTING_RESPONSE);

      const results = await adapter.findRecords(
        "pr-42.preview.cognidao.org",
        "CNAME"
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("rec-existing");

      const url = fetchSpy.mock.calls[0]?.[0] as string;
      expect(url).toContain("name=pr-42.preview.cognidao.org");
      expect(url).toContain("type=CNAME");
    });

    it("returns empty array when no match", async () => {
      mockFetch(FIND_EMPTY_RESPONSE);

      const results = await adapter.findRecords("nonexistent.cognidao.org");
      expect(results).toEqual([]);
    });
  });

  describe("updateRecord", () => {
    it("updates an existing record by ID", async () => {
      mockFetch(UPDATE_RECORD_RESPONSE);

      const result = await adapter.updateRecord(
        "rec-existing",
        {
          name: "pr-42.preview",
          type: "CNAME",
          value: "new-deploy.vercel.app",
          ttl: 300,
        },
        "cognidao.org"
      );

      expect(result.value).toBe("new-deploy.vercel.app");
      const url = fetchSpy.mock.calls[0]?.[0] as string;
      expect(url).toContain("/dns_records/rec-existing");
      expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).method).toBe("PUT");
    });
  });

  describe("deleteRecord", () => {
    it("deletes a record by ID", async () => {
      mockFetch(DELETE_RESPONSE);

      await adapter.deleteRecord("rec-existing");

      const url = fetchSpy.mock.calls[0]?.[0] as string;
      expect(url).toContain("/dns_records/rec-existing");
      expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).method).toBe(
        "DELETE"
      );
    });
  });

  describe("error handling", () => {
    it("throws on Cloudflare API error", async () => {
      mockFetch(ERROR_RESPONSE);

      await expect(adapter.getDnsRecords("bad", "zone")).rejects.toThrow(
        "Cloudflare API error: 7003: Could not route to /zones/bad/dns_records"
      );
    });
  });

  describe("registration methods", () => {
    it("throws on checkAvailability", async () => {
      await expect(adapter.checkAvailability([])).rejects.toThrow(
        "does not support domain registration"
      );
    });

    it("throws on registerDomain", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing error path with invalid input
      await expect(adapter.registerDomain("x.com", {} as any)).rejects.toThrow(
        "does not support domain registration"
      );
    });
  });
});
