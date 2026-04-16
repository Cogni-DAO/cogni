#!/usr/bin/env tsx

// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/db/seed-doltgres`
 * Purpose: Seed Doltgres knowledge databases from per-node knowledge packages.
 * Scope: Reads DOLTGRES_URL, imports seeds from node packages, upserts + commits. Does not create schema or roles (provision script handles that).
 * Invariants: Idempotent (upsert). Requires packages:build to have run first.
 * Side-effects: IO (database writes, console output)
 * Links: docs/spec/knowledge-data-plane.md
 * @public
 */

import type { NewKnowledge } from "@cogni/knowledge-store";
import { createKnowledgeCapability } from "@cogni/knowledge-store";
import {
  buildDoltgresClient,
  DoltgresKnowledgeStoreAdapter,
} from "@cogni/knowledge-store/adapters/doltgres";

const DOLTGRES_URL = process.env.DOLTGRES_URL;

if (!DOLTGRES_URL) {
  console.log("⏭️  DOLTGRES_URL not set — skipping knowledge seed");
  process.exit(0);
}

console.log("🌱 Seeding Doltgres knowledge store...");

const client = buildDoltgresClient({
  connectionString: DOLTGRES_URL,
  applicationName: "cogni_knowledge_seed",
});

const adapter = new DoltgresKnowledgeStoreAdapter({ sql: client });
const capability = createKnowledgeCapability(adapter);

// Load seeds — base seeds from node-template, domain seeds from node packages
const seeds: NewKnowledge[] = [];

try {
  const baseMod = await import("@cogni/node-template-knowledge");
  seeds.push(...baseMod.BASE_KNOWLEDGE_SEEDS);
} catch {
  console.warn("⚠️  Could not load @cogni/node-template-knowledge seeds");
}

try {
  const polyMod = await import("@cogni/poly-knowledge");
  if (polyMod.POLY_KNOWLEDGE_SEEDS) {
    seeds.push(...polyMod.POLY_KNOWLEDGE_SEEDS);
  }
} catch {
  // Not a poly node or package not available — skip
}

if (seeds.length === 0) {
  console.log("   No seeds found.");
  await client.end();
  process.exit(0);
}

console.log(`   Upserting ${seeds.length} seed entries...`);

for (const seed of seeds) {
  try {
    await capability.write(seed);
    console.log(`   ✅ ${seed.id} (${seed.domain})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("nothing to commit")) {
      console.log(`   ⏭️  ${seed.id} (already committed)`);
    } else {
      console.error(`   ❌ ${seed.id}: ${msg}`);
    }
  }
}

console.log("✅ Doltgres knowledge seed complete.");
await client.end();
