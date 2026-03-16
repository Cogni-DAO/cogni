// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/ai/tool-source.factory`
 * Purpose: Create StaticToolSource with real implementations from bindings.
 * Scope: Factory for tool source port. Does NOT execute tools.
 * Invariants:
 *   - TOOL_BINDING_REQUIRED: All catalog tools must have bindings
 *   - CONTRACTS_FROM_CATALOG: Uses contracts from TOOL_CATALOG
 *   - IMPLEMENTATIONS_FROM_BINDINGS: Uses implementations from tool-bindings
 * Side-effects: none
 * Links: TOOL_USE_SPEC.md, container.ts
 * @internal
 */

import { createStaticToolSource, type StaticToolSource } from "@cogni/ai-core";
import { contractToRuntime, TOOL_CATALOG } from "@cogni/ai-tools";

import type { ToolBindings } from "./tool-bindings";

/**
 * Create a StaticToolSource with real implementations from bindings.
 *
 * Per TOOL_BINDING_REQUIRED: Every tool in TOOL_CATALOG must have a
 * corresponding binding. Missing bindings throw at startup to fail fast.
 *
 * Per CONTRACTS_FROM_CATALOG + IMPLEMENTATIONS_FROM_BINDINGS:
 * - Contracts come from TOOL_CATALOG (schema, validation, redaction)
 * - Implementations come from bindings (real I/O with capabilities)
 *
 * @param bindings - Tool bindings map from createToolBindings()
 * @returns StaticToolSource with all catalog tools wired to real implementations
 * @throws Error if any catalog tool is missing a binding
 */
export function createBoundToolSource(
  bindings: ToolBindings
): StaticToolSource {
  const runtimes = [];

  for (const [toolId, boundTool] of Object.entries(TOOL_CATALOG)) {
    const impl = bindings[toolId];
    if (!impl) {
      throw new Error(
        `TOOL_BINDING_REQUIRED: Missing implementation binding for tool "${toolId}". ` +
          `Add binding in src/bootstrap/ai/tool-bindings.ts`
      );
    }
    runtimes.push(contractToRuntime(boundTool.contract, impl));
  }

  return createStaticToolSource(runtimes);
}
