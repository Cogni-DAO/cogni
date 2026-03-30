// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/dns-ops/tests/dns-helpers`
 * Purpose: Unit tests for DNS helper functions — splitDomain, upsertDnsRecord, removeDnsRecord.
 * Scope: Tests generic (non-Cloudflare) read-modify-write path with mocked port. Does NOT test Cloudflare-specific code paths.
 * Invariants: Tests must not make real HTTP calls.
 * Side-effects: none
 * Links: packages/dns-ops/src/domain/dns-helpers.ts
 * @internal
 */

import { describe, expect, it, vi } from "vitest";
import type { DnsRecord, DomainRegistrarPort } from "../src/index.js";
import { removeDnsRecord, splitDomain, upsertDnsRecord } from "../src/index.js";

// ── splitDomain ─────────────────────────────────────────────

describe("splitDomain", () => {
  it("splits a simple .com domain", () => {
    expect(splitDomain("example.com")).toEqual({
      sld: "example",
      tld: "com",
    });
  });

  it("splits a multi-part TLD like .co.uk", () => {
    expect(splitDomain("example.co.uk")).toEqual({
      sld: "example",
      tld: "co.uk",
    });
  });

  it("throws on invalid single-part input", () => {
    expect(() => splitDomain("localhost")).toThrow("Invalid domain");
  });
});

// ── upsertDnsRecord (generic path, not Cloudflare) ──────────

describe("upsertDnsRecord", () => {
  function mockRegistrar(existing: DnsRecord[]): DomainRegistrarPort {
    return {
      checkAvailability: vi.fn(),
      registerDomain: vi.fn(),
      getDnsRecords: vi.fn().mockResolvedValue(existing),
      setDnsRecords: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("appends a new record when no match exists", async () => {
    const existing: DnsRecord[] = [
      { name: "@", type: "A", value: "1.2.3.4", ttl: 1800 },
    ];
    const registrar = mockRegistrar(existing);

    const result = await upsertDnsRecord(registrar, "cognidao.org", {
      name: "pr-42.preview",
      type: "CNAME",
      value: "deploy-abc.vercel.app",
      ttl: 300,
    });

    expect(result).toEqual({
      name: "pr-42.preview",
      type: "CNAME",
      value: "deploy-abc.vercel.app",
      ttl: 300,
    });

    const setCall = vi.mocked(registrar.setDnsRecords).mock.calls.at(0) ?? [];
    expect(setCall[0]).toBe("cognidao");
    expect(setCall[1]).toBe("org");
    expect(setCall[2]).toHaveLength(2);
  });

  it("replaces an existing record with same name+type", async () => {
    const existing: DnsRecord[] = [
      { name: "@", type: "A", value: "1.2.3.4", ttl: 1800 },
      { name: "pr-42.preview", type: "CNAME", value: "old-deploy.vercel.app" },
    ];
    const registrar = mockRegistrar(existing);

    const result = await upsertDnsRecord(registrar, "cognidao.org", {
      name: "pr-42.preview",
      type: "CNAME",
      value: "new-deploy.vercel.app",
      ttl: 300,
    });

    expect(result.value).toBe("new-deploy.vercel.app");

    const setCall = vi.mocked(registrar.setDnsRecords).mock.calls.at(0) ?? [];
    const records = setCall[2] as DnsRecord[];
    expect(records).toHaveLength(2);
    expect(records[1]?.value).toBe("new-deploy.vercel.app");
  });

  it("preserves unrelated records when upserting", async () => {
    const existing: DnsRecord[] = [
      { name: "@", type: "A", value: "1.2.3.4" },
      { name: "mail", type: "MX", value: "mx.example.com", mxPref: 10 },
    ];
    const registrar = mockRegistrar(existing);

    await upsertDnsRecord(registrar, "cognidao.org", {
      name: "pr-1.preview",
      type: "CNAME",
      value: "deploy.vercel.app",
    });

    const setCall = vi.mocked(registrar.setDnsRecords).mock.calls.at(0) ?? [];
    const records = setCall[2] as DnsRecord[];
    expect(records[0]).toEqual({ name: "@", type: "A", value: "1.2.3.4" });
    expect(records[1]).toEqual({
      name: "mail",
      type: "MX",
      value: "mx.example.com",
      mxPref: 10,
    });
  });
});

// ── removeDnsRecord (generic path, not Cloudflare) ──────────

describe("removeDnsRecord", () => {
  function mockRegistrar(existing: DnsRecord[]): DomainRegistrarPort {
    return {
      checkAvailability: vi.fn(),
      registerDomain: vi.fn(),
      getDnsRecords: vi.fn().mockResolvedValue(existing),
      setDnsRecords: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("removes a matching record", async () => {
    const existing: DnsRecord[] = [
      { name: "@", type: "A", value: "1.2.3.4" },
      { name: "pr-42.preview", type: "CNAME", value: "deploy.vercel.app" },
    ];
    const registrar = mockRegistrar(existing);

    await removeDnsRecord(registrar, "cognidao.org", "pr-42.preview", "CNAME");

    expect(registrar.setDnsRecords).toHaveBeenCalled();
    const setCall = vi.mocked(registrar.setDnsRecords).mock.calls.at(0) ?? [];
    expect(setCall[2]).toHaveLength(1);
  });

  it("is a no-op when record does not exist", async () => {
    const existing: DnsRecord[] = [{ name: "@", type: "A", value: "1.2.3.4" }];
    const registrar = mockRegistrar(existing);

    await removeDnsRecord(registrar, "cognidao.org", "nonexistent", "CNAME");

    expect(registrar.setDnsRecords).not.toHaveBeenCalled();
  });
});
