// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/broadcast-core/ports/publish`
 * Purpose: Platform publishing port interface.
 * Scope: One implementation per platform (X, Bluesky, Discord, LinkedIn, Blog). Does not contain implementations.
 * Invariants:
 * - ADAPTERS_ARE_SWAPPABLE: Adding a new platform requires only a new PublishPort implementation
 * Side-effects: none (interface only)
 * Links: docs/spec/broadcasting.md
 * @public
 */

import type { PlatformId, PlatformPost } from "../types";

export interface PublishResult {
  readonly externalId: string;
  readonly externalUrl: string;
}

export interface HealthCheckResult {
  readonly healthy: boolean;
  readonly message?: string;
}

/**
 * Adapter for publishing content to a specific platform.
 * One implementation per platform.
 */
export interface PublishPort {
  readonly platform: PlatformId;

  /** Publish a platform post. Returns external ID + URL on success. */
  publish(post: PlatformPost): Promise<PublishResult>;

  /** Delete a previously published post (best-effort). */
  delete(externalId: string): Promise<void>;

  /** Check if credentials/connection are valid. */
  healthCheck(): Promise<HealthCheckResult>;
}
