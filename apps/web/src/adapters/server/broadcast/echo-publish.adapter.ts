// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/broadcast/echo-publish`
 * Purpose: Mock PublishPort for Crawl — logs publish intent, returns deterministic fake result.
 * Scope: Crawl-only mock adapter. Does not call any external API.
 * Invariants: ADAPTERS_ARE_SWAPPABLE — implements PublishPort interface.
 * Side-effects: IO (logging via Pino)
 * Notes: All broadcast adapters will move to packages/broadcast-core once
 *   unified-graph-launch lands GraphExecutorPort in a package (see docs/spec/unified-graph-launch.md).
 * Links: docs/spec/broadcasting.md
 * @internal
 */

import type {
  HealthCheckResult,
  PlatformId,
  PlatformPost,
  PublishPort,
  PublishResult,
} from "@cogni/broadcast-core";
import type { Logger } from "pino";

export class EchoPublishAdapter implements PublishPort {
  readonly platform: PlatformId;
  private readonly log: Logger;

  constructor(platform: PlatformId, log: Logger) {
    this.platform = platform;
    this.log = log.child({ adapter: "echo-publish", platform });
  }

  async publish(post: PlatformPost): Promise<PublishResult> {
    const externalId = `echo-${post.platform}-${post.id}`;
    const externalUrl = `https://echo.local/${post.platform}/${externalId}`;

    this.log.info(
      {
        postId: post.id,
        platform: post.platform,
        bodyLength: post.optimizedBody.length,
        externalId,
      },
      "echo_publish: would publish to platform"
    );

    return { externalId, externalUrl };
  }

  async delete(externalId: string): Promise<void> {
    this.log.info({ externalId }, "echo_publish: would delete from platform");
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: true, message: "Echo adapter always healthy" };
  }
}
