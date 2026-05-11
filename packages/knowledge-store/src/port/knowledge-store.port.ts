// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/port`
 * Purpose: KnowledgeStorePort — typed capability for versioned domain knowledge.
 * Scope: Port interface + domain-registry types + typed errors. Does not contain implementations, I/O, or framework dependencies.
 * Invariants:
 *   - PORT_BEFORE_BACKEND: All knowledge access goes through this port.
 *   - PACKAGES_NO_ENV, PACKAGES_NO_LIFECYCLE.
 *   - DOMAIN_FK_ENFORCED_AT_WRITE: every write to knowledge verifies `domain` exists.
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md, docs/spec/knowledge-domain-registry.md
 * @public
 */

import type {
  DoltCommit,
  DoltDiffEntry,
  Knowledge,
  NewKnowledge,
} from "../domain/schemas.js";

// ---------------------------------------------------------------------------
// Domain registry types
// ---------------------------------------------------------------------------

export interface Domain {
  id: string;
  name: string;
  description: string | null;
  confidencePct: number;
  entryCount: number;
  createdAt: string; // ISO timestamp
}

export interface NewDomain {
  id: string;
  name: string;
  description?: string;
}

export class DomainNotRegisteredError extends Error {
  readonly domain: string;
  constructor(domain: string) {
    super(`domain '${domain}' not registered`);
    this.name = "DomainNotRegisteredError";
    this.domain = domain;
  }
}

export class DomainAlreadyRegisteredError extends Error {
  readonly domain: string;
  constructor(domain: string) {
    super(`domain '${domain}' already registered`);
    this.name = "DomainAlreadyRegisteredError";
    this.domain = domain;
  }
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface KnowledgeStorePort {
  // --- Read ---
  getKnowledge(id: string): Promise<Knowledge | null>;
  listKnowledge(
    domain: string,
    opts?: { tags?: string[]; limit?: number }
  ): Promise<Knowledge[]>;
  searchKnowledge(
    domain: string,
    query: string,
    opts?: { limit?: number }
  ): Promise<Knowledge[]>;
  /** List distinct domain values present in the `knowledge` table (legacy / back-compat). */
  listDomains(): Promise<string[]>;

  // --- Domain registry (DOMAIN_FK_ENFORCED_AT_WRITE) ---
  /** Returns true iff `id` is a row in the `domains` table. */
  domainExists(id: string): Promise<boolean>;
  /** Full `domains` rows + `entry_count` (LEFT JOIN knowledge, single query). */
  listDomainsFull(): Promise<Domain[]>;
  /**
   * Insert a new row in `domains` and auto-commit. Throws
   * `DomainAlreadyRegisteredError` on duplicate id.
   */
  registerDomain(input: NewDomain): Promise<Domain>;

  // --- Write ---
  /** Upsert: inserts new entry or updates existing entry with same ID. */
  upsertKnowledge(entry: NewKnowledge): Promise<Knowledge>;
  addKnowledge(entry: NewKnowledge): Promise<Knowledge>;
  updateKnowledge(
    id: string,
    update: Partial<NewKnowledge>
  ): Promise<Knowledge>;
  deleteKnowledge(id: string): Promise<void>;

  // --- Doltgres versioning ---
  commit(message: string): Promise<string>;
  log(limit?: number): Promise<DoltCommit[]>;
  diff(fromRef: string, toRef: string): Promise<DoltDiffEntry[]>;
  currentCommit(): Promise<string>;
}
