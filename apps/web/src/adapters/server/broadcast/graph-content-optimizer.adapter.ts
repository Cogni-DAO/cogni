// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/broadcast/graph-content-optimizer`
 * Purpose: ContentOptimizerPort via broadcast-writer LangGraph graph with full billing/observability stack.
 * Scope: Reads platform skill guide, runs graph, returns optimized post. Does not contain business logic.
 * Invariants:
 *   - ADAPTERS_ARE_SWAPPABLE — implements ContentOptimizerPort interface
 *   - PREFLIGHT_BEFORE_FIRST_YIELD — credit check runs before graph execution
 *   - BILLING_ENRICHMENT — usage events carry billingAccountId + virtualKeyId
 * Side-effects: IO (LLM calls via GraphExecutorPort, filesystem reads for skill docs)
 * Links: docs/spec/broadcasting.md, packages/broadcast-core/platform-skills/
 * @internal
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessRisk,
  type ContentMessage,
  type ContentOptimizerPort,
  type GenerationPolicy,
  type PlatformId,
  type PlatformPostDraft,
} from "@cogni/broadcast-core";
import type { GraphExecutorPort } from "@cogni/graph-execution-core";
import type { Logger } from "pino";

/** Resolve the platform skill doc path relative to broadcast-core package. */
function resolvePlatformSkillPath(platformId: PlatformId): string {
  // broadcast-core is in node_modules/@cogni/broadcast-core or packages/broadcast-core
  // The skill docs live at packages/broadcast-core/platform-skills/<platform>.md
  // We resolve relative to the monorepo root via process.cwd()
  return join(
    process.cwd(),
    "packages",
    "broadcast-core",
    "platform-skills",
    `${platformId}.md`
  );
}

/**
 * Graph-backed ContentOptimizerPort.
 *
 * Per-request instance — created by the container factory with the caller's
 * billing context, same pattern as accountsForUser(userId).
 *
 * Runs the `broadcast-writer` LangGraph graph through the full scoped executor
 * stack (billing enrichment, preflight credit check, observability).
 */
export class GraphContentOptimizerAdapter implements ContentOptimizerPort {
  constructor(
    private readonly executor: GraphExecutorPort,
    private readonly log: Logger
  ) {}

  async optimize(
    message: ContentMessage,
    targetPlatform: PlatformId,
    _policy?: GenerationPolicy
  ): Promise<PlatformPostDraft> {
    // 1. Read platform skill guide
    const skillPath = resolvePlatformSkillPath(targetPlatform);
    let platformSkillGuide: string;
    try {
      platformSkillGuide = readFileSync(skillPath, "utf-8");
    } catch {
      this.log.warn(
        { platform: targetPlatform, skillPath },
        "Platform skill guide not found — falling back to echo optimization"
      );
      // Graceful fallback: no skill doc = simple prefix (same as echo adapter)
      const riskLevel = assessRisk(message);
      return {
        optimizedBody: `[${targetPlatform}] ${message.body}`,
        platformMetadata: { fallback: true, platform: targetPlatform },
        riskLevel,
      };
    }

    // 2. Build user message with skill guide + content
    const userMessage = [
      `## Platform Skill Guide (${targetPlatform})\n\n${platformSkillGuide}`,
      `## Original Content\n\n${message.title ? `**Title:** ${message.title}\n\n` : ""}${message.body}`,
      "## Instructions\n\nAdapt the original content for this platform following the skill guide above. Output ONLY the adapted post content.",
    ].join("\n\n---\n\n");

    // 3. Run broadcast-writer graph
    const runId = crypto.randomUUID();
    const result = this.executor.runGraph(
      {
        runId,
        graphId: "langgraph:broadcast-writer",
        messages: [{ role: "user" as const, content: userMessage }],
        modelRef: { providerKey: "platform", modelId: "gpt-4o-mini" },
      },
      { requestId: runId }
    );

    // 4. Drain stream and extract assistant_final content
    let optimizedBody = "";
    for await (const event of result.stream) {
      if (event.type === "assistant_final") {
        optimizedBody = (event as { type: "assistant_final"; content: string })
          .content;
      }
    }

    const final = await result.final;
    if (!final.ok) {
      this.log.error(
        { platform: targetPlatform, error: final.error, runId },
        "broadcast-writer graph execution failed"
      );
      throw new Error(
        `Content optimization failed for ${targetPlatform}: ${final.error}`
      );
    }

    // 5. Assess risk based on original message (per spec: risk on intent, not output)
    const riskLevel = assessRisk(message);

    this.log.info(
      {
        platform: targetPlatform,
        runId,
        inputLength: message.body.length,
        outputLength: optimizedBody.length,
        riskLevel,
        usage: final.usage,
      },
      "broadcast-writer optimization complete"
    );

    return {
      optimizedBody: optimizedBody || `[${targetPlatform}] ${message.body}`,
      platformMetadata: {
        graphRunId: runId,
        platform: targetPlatform,
        ...(final.usage ? { usage: final.usage } : {}),
      },
      riskLevel,
      ...(message.title != null ? { optimizedTitle: message.title } : {}),
      ...(riskLevel !== "low"
        ? { riskReason: `Risk assessment: ${riskLevel}` }
        : {}),
    };
  }
}
