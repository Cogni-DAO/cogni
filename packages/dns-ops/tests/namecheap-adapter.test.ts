// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/dns-ops/tests/namecheap-adapter`
 * Purpose: Unit tests for NamecheapAdapter — mocked fetch, XML response parsing.
 * Scope: Tests all Namecheap API operations including error handling. Does NOT make real HTTP calls.
 * Invariants: Tests must not make real HTTP calls.
 * Side-effects: none
 * Links: packages/dns-ops/src/adapters/namecheap.adapter.ts
 * @internal
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NamecheapAdapter } from "../src/index.js";

// ── XML response fixtures ───────────────────────────────────

const CHECK_AVAILABLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
  <CommandResponse Type="namecheap.domains.check">
    <DomainCheckResult Domain="example.com" Available="true" />
    <DomainCheckResult Domain="google.com" Available="false" />
  </CommandResponse>
</ApiResponse>`;

const REGISTER_SUCCESS_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
  <CommandResponse Type="namecheap.domains.create">
    <DomainCreateResult Domain="newdomain.com" Registered="true" DomainID="12345" OrderID="67890" TransactionID="11111" ChargedAmount="10.87" />
  </CommandResponse>
</ApiResponse>`;

const GET_HOSTS_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="cognidao.org" IsUsingOurDNS="true">
      <host Name="@" Type="A" Address="1.2.3.4" TTL="1800" />
      <host Name="www" Type="CNAME" Address="cognidao.org." TTL="1800" />
      <host Name="mail" Type="MX" Address="mx.example.com" MXPref="10" TTL="1800" />
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`;

const SET_HOSTS_SUCCESS_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK">
  <CommandResponse Type="namecheap.domains.dns.setHosts">
    <DomainDNSSetHostsResult Domain="cognidao.org" IsSuccess="true" />
  </CommandResponse>
</ApiResponse>`;

const ERROR_XML = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="ERROR">
  <Errors>
    <Error Number="2019166">Domain not found</Error>
  </Errors>
</ApiResponse>`;

// ── Tests ───────────────────────────────────────────────────

describe("NamecheapAdapter", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  function mockFetch(xml: string) {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(xml, {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      })
    );
  }

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  const adapter = new NamecheapAdapter({
    apiUser: "testuser",
    apiKey: "test-api-key",
    clientIp: "127.0.0.1",
    sandbox: true,
  });

  describe("checkAvailability", () => {
    it("parses available and unavailable domains", async () => {
      mockFetch(CHECK_AVAILABLE_XML);

      const results = await adapter.checkAvailability([
        "example.com",
        "google.com",
      ]);

      expect(results).toEqual([
        { domain: "example.com", available: true },
        { domain: "google.com", available: false },
      ]);

      // Verify it hit the sandbox URL
      const url = new URL(fetchSpy.mock.calls[0]?.[0] as string);
      expect(url.hostname).toBe("api.sandbox.namecheap.com");
      expect(url.searchParams.get("Command")).toBe("namecheap.domains.check");
    });
  });

  describe("registerDomain", () => {
    it("parses a successful registration", async () => {
      mockFetch(REGISTER_SUCCESS_XML);

      const result = await adapter.registerDomain("newdomain.com", {
        firstName: "Cogni",
        lastName: "DAO",
        address1: "123 Blockchain Ave",
        city: "Austin",
        stateProvince: "TX",
        postalCode: "78701",
        country: "US",
        phone: "+1.5551234567",
        email: "admin@cognidao.org",
      });

      expect(result).toEqual({
        domain: "newdomain.com",
        success: true,
        domainId: 12345,
        orderId: 67890,
        transactionId: 11111,
        chargedAmount: 10.87,
      });

      const url = new URL(fetchSpy.mock.calls[0]?.[0] as string);
      expect(url.searchParams.get("RegistrantFirstName")).toBe("Cogni");
      expect(url.searchParams.get("TechFirstName")).toBe("Cogni");
      expect(url.searchParams.get("AdminFirstName")).toBe("Cogni");
    });
  });

  describe("getDnsRecords", () => {
    it("parses host records including MX", async () => {
      mockFetch(GET_HOSTS_XML);

      const records = await adapter.getDnsRecords("cognidao", "org");

      expect(records).toEqual([
        {
          name: "@",
          type: "A",
          value: "1.2.3.4",
          ttl: 1800,
          mxPref: undefined,
        },
        {
          name: "www",
          type: "CNAME",
          value: "cognidao.org.",
          ttl: 1800,
          mxPref: undefined,
        },
        {
          name: "mail",
          type: "MX",
          value: "mx.example.com",
          ttl: 1800,
          mxPref: 10,
        },
      ]);
    });

    it("returns empty array when no hosts", async () => {
      mockFetch(`<?xml version="1.0" encoding="utf-8"?>
        <ApiResponse Status="OK">
          <CommandResponse Type="namecheap.domains.dns.getHosts">
            <DomainDNSGetHostsResult Domain="empty.org" IsUsingOurDNS="true" />
          </CommandResponse>
        </ApiResponse>`);

      const records = await adapter.getDnsRecords("empty", "org");
      expect(records).toEqual([]);
    });
  });

  describe("setDnsRecords", () => {
    it("sends indexed params and succeeds", async () => {
      mockFetch(SET_HOSTS_SUCCESS_XML);

      await adapter.setDnsRecords("cognidao", "org", [
        { name: "@", type: "A", value: "1.2.3.4", ttl: 1800 },
        {
          name: "pr-1.preview",
          type: "CNAME",
          value: "deploy.vercel.app",
          ttl: 300,
        },
      ]);

      const url = new URL(fetchSpy.mock.calls[0]?.[0] as string);
      expect(url.searchParams.get("HostName1")).toBe("@");
      expect(url.searchParams.get("RecordType1")).toBe("A");
      expect(url.searchParams.get("Address1")).toBe("1.2.3.4");
      expect(url.searchParams.get("HostName2")).toBe("pr-1.preview");
      expect(url.searchParams.get("RecordType2")).toBe("CNAME");
      expect(url.searchParams.get("TTL2")).toBe("300");
    });

    it("includes MXPref for MX records", async () => {
      mockFetch(SET_HOSTS_SUCCESS_XML);

      await adapter.setDnsRecords("cognidao", "org", [
        {
          name: "mail",
          type: "MX",
          value: "mx.example.com",
          ttl: 1800,
          mxPref: 10,
        },
      ]);

      const url = new URL(fetchSpy.mock.calls[0]?.[0] as string);
      expect(url.searchParams.get("RecordType1")).toBe("MX");
      expect(url.searchParams.get("MXPref1")).toBe("10");
    });

    it("throws on failure response", async () => {
      mockFetch(`<?xml version="1.0" encoding="utf-8"?>
        <ApiResponse Status="OK">
          <CommandResponse Type="namecheap.domains.dns.setHosts">
            <DomainDNSSetHostsResult Domain="cognidao.org" IsSuccess="false" />
          </CommandResponse>
        </ApiResponse>`);

      await expect(
        adapter.setDnsRecords("cognidao", "org", [])
      ).rejects.toThrow("Failed to set DNS records");
    });
  });

  describe("error handling", () => {
    it("throws on Namecheap API error response", async () => {
      mockFetch(ERROR_XML);

      await expect(adapter.checkAvailability(["bad.com"])).rejects.toThrow(
        "Namecheap API error: Domain not found"
      );
    });

    it("throws with concatenated messages for multiple API errors", async () => {
      mockFetch(`<?xml version="1.0" encoding="utf-8"?>
        <ApiResponse Status="ERROR">
          <Errors>
            <Error Number="1">First error</Error>
            <Error Number="2">Second error</Error>
          </Errors>
        </ApiResponse>`);

      await expect(adapter.checkAvailability(["bad.com"])).rejects.toThrow(
        "Namecheap API error: First error; Second error"
      );
    });

    it("throws on HTTP error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Internal Server Error", { status: 500 })
      );

      await expect(adapter.checkAvailability(["bad.com"])).rejects.toThrow(
        "Namecheap API HTTP 500"
      );
    });
  });

  describe("sandbox vs production", () => {
    it("uses production URL when sandbox is false", async () => {
      const prod = new NamecheapAdapter({
        apiUser: "user",
        apiKey: "key",
        clientIp: "1.2.3.4",
        sandbox: false,
      });
      mockFetch(CHECK_AVAILABLE_XML);
      await prod.checkAvailability(["test.com"]);

      const url = new URL(fetchSpy.mock.calls[0]?.[0] as string);
      expect(url.hostname).toBe("api.namecheap.com");
    });
  });
});
