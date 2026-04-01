// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/server/ai/aggregating-executor`
 * Purpose: Unit tests for NamespaceGraphRouter routing behavior.
 * Scope: Verifies graphId namespace routing, provider dispatch. Does NOT test actual graph execution, billing, or provider internals.
 * Invariants:
 *   - ROUTING_BY_NAMESPACE_ONLY: Routes by graphId.split(":")[0] to Map<string, GraphExecutorPort>
 * Side-effects: none
 * Notes: Discovery (listAgents) is tested in aggregating-agent-catalog.spec.ts
 * Links: aggregating-executor.ts, GRAPH_EXECUTION.md
 * @public
 */

import {
  createMockGraphExecutor,
  createTestGraphRunRequest,
} from "@tests/_fixtures/ai/fixtures";
import { describe, expect, it, vi } from "vitest";
import { NamespaceGraphRouter } from "@/adapters/server/ai/aggregating-executor";
import type { GraphExecutorPort } from "@/ports";

describe("NamespaceGraphRouter", () => {
  describe("fail-fast behavior", () => {
    it("returns error when graphId namespace does not match any provider", async () => {
      const provider = createMockGraphExecutor();
      const router = new NamespaceGraphRouter(
        new Map([["langgraph", provider]])
      );

      const request = createTestGraphRunRequest({ graphId: "unknown:graph" });
      const result = router.runGraph(request);

      const final = await result.final;
      expect(final.ok).toBe(false);
      expect(final.error).toBe("internal");

      // Provider should NOT be called
      expect(provider.runGraph).not.toHaveBeenCalled();
    });

    it("returns error when graphId has no namespace separator", async () => {
      const provider = createMockGraphExecutor();
      const router = new NamespaceGraphRouter(
        new Map([["langgraph", provider]])
      );

      const request = createTestGraphRunRequest({
        graphId: "nocolon" as import("@cogni/ai-core").GraphId,
      });
      const result = router.runGraph(request);

      const final = await result.final;
      expect(final.ok).toBe(false);
      expect(final.error).toBe("internal");

      expect(provider.runGraph).not.toHaveBeenCalled();
    });
  });

  describe("routing", () => {
    it("routes to correct provider based on graphId namespace", async () => {
      const langGraphProvider = createMockGraphExecutor();
      const claudeProvider = createMockGraphExecutor();
      const router = new NamespaceGraphRouter(
        new Map<string, GraphExecutorPort>([
          ["langgraph", langGraphProvider],
          ["claude_sdk", claudeProvider],
        ])
      );

      // Route to langgraph provider
      const request1 = createTestGraphRunRequest({ graphId: "langgraph:poet" });
      router.runGraph(request1);
      expect(langGraphProvider.runGraph).toHaveBeenCalledWith(
        request1,
        undefined
      );
      expect(claudeProvider.runGraph).not.toHaveBeenCalled();

      // Reset mocks
      vi.clearAllMocks();

      // Route to claude provider
      const request2 = createTestGraphRunRequest({
        graphId: "claude_sdk:planner",
      });
      router.runGraph(request2);
      expect(claudeProvider.runGraph).toHaveBeenCalledWith(request2, undefined);
      expect(langGraphProvider.runGraph).not.toHaveBeenCalled();
    });

    it("routes deterministically by namespace — Map lookup, not iteration", () => {
      // With Map, same namespace → same provider (no ambiguity)
      const provider = createMockGraphExecutor();
      const router = new NamespaceGraphRouter(new Map([["shared", provider]]));

      const request = createTestGraphRunRequest({
        graphId: "shared:test" as import("@cogni/ai-core").GraphId,
      });
      router.runGraph(request);

      expect(provider.runGraph).toHaveBeenCalledWith(request, undefined);
    });
  });
});
