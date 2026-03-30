// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/dns-ops/scripts/create-preview`
 * Purpose: Create a preview subdomain for testing. Does NOT touch protected records.
 * Scope: Manual testing only. Does NOT run in CI.
 * Invariants: Protected names (@, www) blocked by helpers.
 * Side-effects: IO (creates DNS records on Cloudflare)
 * Links: packages/dns-ops/docs/cloudflare-dns-setup.md
 * @internal
 */

import {
  CloudflareAdapter,
  removeDnsRecord,
  upsertDnsRecord,
} from "../src/index.js";

const cf = new CloudflareAdapter({
  apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
  zoneId: process.env.CLOUDFLARE_ZONE_ID ?? "",
});

async function main() {
  // Clean up old CNAME first (can't have CNAME + A on same name)
  await removeDnsRecord(cf, "cognidao.org", "hello-world.preview", "CNAME");

  const result = await upsertDnsRecord(cf, "cognidao.org", {
    name: "hello-world.preview",
    type: "A",
    value: "185.199.108.153",
    ttl: 300,
  });
  console.log("Created:", result.name, "→", result.value);
  console.log("\nVisit: http://hello-world.preview.cognidao.org");
  console.log("(GitHub Pages IP — shows a 404 page, proving DNS resolves)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
