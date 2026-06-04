// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/showcase/getShowcaseNodes.server`
 * Purpose: Server entry that reads the base domain from env and resolves the curated showcase nodes.
 * Scope: Server-only env wiring. All host-mapping logic lives in (pure) nodes.resolve.ts.
 * Side-effects: reads env (serverEnv) only.
 * Links: src/features/home/showcase/nodes.resolve.ts, src/features/home/showcase/nodes.data.ts
 * @public
 */

import { serverEnv } from "@/shared/env";

import { SHOWCASE_NODES } from "./nodes.data";
import {
  baseDomain,
  type ResolvedShowcaseNode,
  resolveShowcaseNodes,
} from "./nodes.resolve";

export type { ResolvedShowcaseNode };

/** Curated showcase nodes resolved to live hrefs for rendering. */
export function getShowcaseNodes(): readonly ResolvedShowcaseNode[] {
  return resolveShowcaseNodes(SHOWCASE_NODES, baseDomain(serverEnv()));
}
