// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/broadcast/echo-content-optimizer`
 * Purpose: Mock ContentOptimizerPort for Crawl — returns body as-is with platform prefix and deterministic risk.
 * Scope: Crawl-only mock adapter. Does not call any LLM or external service.
 * Invariants: ADAPTERS_ARE_SWAPPABLE — implements ContentOptimizerPort interface.
 * Side-effects: none
 * Notes: All broadcast adapters will move to packages/broadcast-core once
 *   unified-graph-launch lands GraphExecutorPort in a package (see docs/spec/unified-graph-launch.md).
 *   Real LLM optimizer will use GraphExecutorPort for platform-specific formatting.
 * Links: docs/spec/broadcasting.md
 * @internal
 */

import {
  assessRisk,
  type ContentMessage,
  type ContentOptimizerPort,
  type GenerationPolicy,
  type PlatformId,
  type PlatformPostDraft,
} from "@cogni/broadcast-core";

export class EchoContentOptimizerAdapter implements ContentOptimizerPort {
  async optimize(
    message: ContentMessage,
    targetPlatform: PlatformId,
    _policy?: GenerationPolicy
  ): Promise<PlatformPostDraft> {
    // Echo: pass body through with platform context
    const optimizedBody = `[${targetPlatform}] ${message.body}`;
    const riskLevel = assessRisk(message);

    return {
      optimizedBody,
      platformMetadata: { echoAdapter: true, platform: targetPlatform },
      riskLevel,
      ...(message.title != null ? { optimizedTitle: message.title } : {}),
      ...(riskLevel !== "low"
        ? { riskReason: `Echo risk assessment: ${riskLevel}` }
        : {}),
    };
  }
}
