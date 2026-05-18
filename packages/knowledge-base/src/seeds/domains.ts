// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-base/seeds/domains`
 * Purpose: Base `domains` registry rows. Every knowledge entry's `domain` column references one of these.
 *   New domains can be added per-node by inserting additional rows + Dolt commit (per knowledge-syntropy spec).
 * Scope: Seed data definitions only. Does not perform I/O — the migrator (or first-write path on candidate-a) applies these.
 * Invariants: Domain `id`s are stable identifiers. New domains are append-only and registered explicitly per knowledge-syntropy.
 * Side-effects: none
 * Links: docs/spec/knowledge-syntropy.md
 * @public
 */

export interface NewDomain {
  id: string;
  name: string;
  description?: string;
}

export const BASE_DOMAIN_SEEDS: NewDomain[] = [
  {
    id: "meta",
    name: "Meta",
    description: "Knowledge about the knowledge system itself.",
  },
  {
    id: "prediction-market",
    name: "Prediction Markets",
    description:
      "Polymarket and adjacent prediction-market knowledge — base rates, market structure, calibration.",
  },
  {
    id: "infrastructure",
    name: "Infrastructure",
    description:
      "Runtime, deploy, observability, and capacity knowledge for Cogni nodes.",
  },
  {
    id: "governance",
    name: "Governance",
    description:
      "DAO formation, attribution, voting, and operator/node contracts.",
  },
  {
    id: "reservations",
    name: "Reservations",
    description:
      "Restaurant / venue reservation knowledge for the resy node domain.",
  },
];
