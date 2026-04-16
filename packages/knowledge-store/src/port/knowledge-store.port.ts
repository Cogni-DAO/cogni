// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/port`
 * Purpose: KnowledgeStorePort — typed capability for versioned domain knowledge.
 * Scope: Port interface only. Does not contain implementations or I/O.
 * Invariants:
 *   - PORT_BEFORE_BACKEND: All knowledge access goes through this port.
 *   - PACKAGES_NO_ENV, PACKAGES_NO_LIFECYCLE.
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md
 * @public
 */

import type {
  DoltCommit,
  DoltDiffEntry,
  Knowledge,
  NewKnowledge,
} from "../domain/schemas.js";

/**
 * Knowledge store port — read, write, and version domain knowledge.
 *
 * Read operations:
 *   - All agents within a node can read (knowledge_reader role).
 *
 * Write operations:
 *   - Authorized agents within a node can write (knowledge_writer role).
 *   - Writes are not visible to other sessions until committed.
 *
 * Versioning operations:
 *   - commit() creates a Doltgres commit (snapshot of current state).
 *   - log() returns the commit history.
 *   - diff() shows what changed between two commits.
 *   - currentCommit() returns the HEAD commit hash.
 *
 * Roadmap:
 *   - External agents read via x402 payment protocol (read-only, metered).
 *   - Agentic contributions: external agent → staging area → human/AI review → merge.
 */
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
  /** List distinct domains in the knowledge store. Agents use this to browse what's available. */
  listDomains(): Promise<string[]>;

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
  commit(message: string): Promise<string>; // returns commit hash
  log(limit?: number): Promise<DoltCommit[]>;
  diff(fromRef: string, toRef: string): Promise<DoltDiffEntry[]>;
  currentCommit(): Promise<string>;
}
