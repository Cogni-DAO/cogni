// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/chat/model`
 * Purpose: Re-exports canonical message types from @cogni/ai-core.
 * Scope: Backward-compat re-export. Canonical definitions live in @cogni/ai-core. Does NOT define types locally.
 * Invariants: No Date objects, no I/O dependencies, purely functional types
 * Side-effects: none
 * Links: @cogni/ai-core/src/message/types.ts
 * @public
 */

export type {
  Message,
  MessageRole,
  MessageToolCall,
} from "@cogni/ai-core";
