// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/ports/content-optimizer`
 * Purpose: Content optimization port interface for AI-based platform formatting.
 * Scope: Transforms ContentMessage body into platform-optimized text. Does not contain implementations.
 * Invariants: One optimization per platform per message.
 * Side-effects: none (interface only)
 * Links: docs/spec/broadcasting.md
 * @public
 */

import type { ContentMessage, PlatformId, RiskLevel } from "../types";

export interface OptimizationResult {
  readonly optimizedBody: string;
  readonly optimizedTitle?: string;
  readonly platformMetadata: Record<string, unknown>;
  readonly riskLevel: RiskLevel;
  readonly riskReason?: string;
}

/**
 * Transforms a ContentMessage into platform-optimized content.
 * Implementation uses LLM via GraphExecutorPort.
 */
export interface ContentOptimizerPort {
  optimize(
    message: ContentMessage,
    targetPlatform: PlatformId
  ): Promise<OptimizationResult>;
}
