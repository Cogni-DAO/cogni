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

  describe("setDnsRecords", () => {
    it("deletes existing records then creates new ones", async () => {
      // Sequence: getDnsRecords (list) → delete rec-1, delete rec-2 → create new-1
      mockFetchSequence(
        LIST_RECORDS_RESPONSE, // getDnsRecords page 1
        DELETE_RESPONSE, // delete rec-1
        DELETE_RESPONSE, // delete rec-2
        CREATE_RECORD_RESPONSE // create new record
      );

      await adapter.setDnsRecords("cognidao", "org", [
        {
          name: "new.cognidao.org",
          type: "A",
          value: "5.6.7.8",
          ttl: 300,
        },
      ]);

      // 1 list + 2 deletes + 1 create = 4 calls
      expect(fetchSpy).toHaveBeenCalledTimes(4);

      // First call: list records
      const listUrl = fetchSpy.mock.calls[0]?.[0] as string;
      expect(listUrl).toContain("/dns_records?per_page=100");

      // Last call: create
      const createInit = fetchSpy.mock.calls[3]?.[1] as RequestInit;
      expect(createInit.method).toBe("POST");
      const body = JSON.parse(createInit.body as string);
      expect(body.content).toBe("5.6.7.8");
    });
  });

  describe("pagination", () => {
    it("fetches multiple pages of records", async () => {
      const page1 = {
        success: true,
        result: [
          {
            id: "rec-p1",
            type: "A",
            name: "a.cognidao.org",
            content: "1.1.1.1",
            ttl: 1,
            proxied: false,
          },
        ],
        result_info: { page: 1, per_page: 100, total_pages: 2 },
      };
      const page2 = {
        success: true,
        result: [
          {
            id: "rec-p2",
            type: "A",
            name: "b.cognidao.org",
            content: "2.2.2.2",
            ttl: 1,
            proxied: false,
          },
        ],
        result_info: { page: 2, per_page: 100, total_pages: 2 },
      };
      mockFetchSequence(page1, page2);

      const records = await adapter.getDnsRecords("cognidao", "org");

      expect(records).toHaveLength(2);
      expect(records[0]?.value).toBe("1.1.1.1");
      expect(records[1]?.value).toBe("2.2.2.2");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("MX record conversion", () => {
    it("includes priority for MX records", async () => {
      mockFetch(CREATE_RECORD_RESPONSE);

      await adapter.createRecord(
        {
          name: "mail",
          type: "MX",
          value: "mx.example.com",
          mxPref: 10,
        },
        "cognidao.org"
      );

      const body = JSON.parse(
        (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string
      );
      expect(body.priority).toBe(10);
      expect(body.type).toBe("MX");
    });

    it("omits priority for non-MX records", async () => {
      mockFetch(CREATE_RECORD_RESPONSE);

      await adapter.createRecord(
        {
          name: "test",
          type: "A",
          value: "1.2.3.4",
        },
        "cognidao.org"
      );

      const body = JSON.parse(
        (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string
      );
      expect(body.priority).toBeUndefined();
    });

    it("parses MX priority from Cloudflare response", async () => {
      mockFetch({
        success: true,
        result: [
          {
            id: "rec-mx",
            type: "MX",
            name: "cognidao.org",
            content: "mx.example.com",
            ttl: 1,
            proxied: false,
            priority: 10,
          },
        ],
        result_info: { page: 1, per_page: 100, total_pages: 1 },
      });

      const records = await adapter.getDnsRecords("cognidao", "org");
      expect(records[0]?.mxPref).toBe(10);
    });
  });

  describe("error handling", () => {
    it("throws on Cloudflare API error", async () => {
      mockFetch(ERROR_RESPONSE);

      await expect(adapter.getDnsRecords("bad", "zone")).rejects.toThrow(
        "Cloudflare API error: 7003: Could not route to /zones/bad/dns_records"
      );
    });

    it("shows 'Unknown error' when no error details provided", async () => {
      mockFetch({ success: false });

      await expect(adapter.getDnsRecords("bad", "zone")).rejects.toThrow(
        "Cloudflare API error: Unknown error"
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
