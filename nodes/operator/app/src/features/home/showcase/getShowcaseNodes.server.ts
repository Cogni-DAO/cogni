// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/showcase/getShowcaseNodes.server`
 * Purpose: Server accessor composing the node registry for the homepage: operator's curated bundled
 *   nodes (shipped screenshots) + the live DB projection (wizard/submodule nodes that are `active`),
 *   deduped by slug (bundled wins). The page depends on this accessor + the port's NodeSummary.
 * Scope: Server-only wiring — env base domain + a service-role (non-RLS) read of listed node slugs.
 * Side-effects: reads env (serverEnv) and the operator DB (service role) on call.
 * Links: src/adapters/server/node-registry/db-node-registry.adapter.ts, src/shared/node-registry/resolve.ts
 * @public
 */

import { eq } from "drizzle-orm";
import { DbNodeRegistryAdapter } from "@/adapters/server/node-registry/db-node-registry.adapter";
import { resolveServiceDb } from "@/bootstrap/container";
import type { NodeSummary } from "@/ports";
import { nodes } from "@/shared/db/nodes";
import { serverEnv } from "@/shared/env";
import { baseDomain, mergeBySlug } from "@/shared/node-registry/resolve";

import { SHOWCASE_NODES } from "./nodes.data";
import { StaticNodeRegistryAdapter } from "./static-node-registry.adapter";

/** Service-role read of publicly-listed node slugs (status='active'), non-owner-scoped. */
async function listActiveNodeSlugs(): Promise<readonly string[]> {
  const rows = await resolveServiceDb()
    .select({ slug: nodes.slug })
    .from(nodes)
    .where(eq(nodes.status, "active"));
  return rows.map((r) => r.slug);
}

/** Public showcase nodes for the homepage: bundled curated nodes + live DB projection, deduped. */
export async function listShowcaseNodes(): Promise<readonly NodeSummary[]> {
  const domain = baseDomain(serverEnv());
  const bundled = new StaticNodeRegistryAdapter(SHOWCASE_NODES, domain);
  const dynamic = new DbNodeRegistryAdapter({
    listListedSlugs: listActiveNodeSlugs,
    domain,
  });
  const [bundledNodes, dynamicNodes] = await Promise.all([
    bundled.listPublic(),
    dynamic.listPublic(),
  ]);
  return mergeBySlug(bundledNodes, dynamicNodes);
}
