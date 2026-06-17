// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: tests for `@features/nodes/observability-access`.
 * Purpose: Pin the v0 issuance decision: graceful-unwired when either env value is absent,
 *   a granted shared-env Viewer credential when both present, and the disclosed env-wide caveat.
 * Scope: Pure logic only — no network/auth/env.
 * Links: src/features/nodes/observability-access.ts, task.5025
 */

import { describe, expect, it } from "vitest";
import {
  resolveObservabilityAccess,
  SHARED_ENV_CAVEAT,
} from "@/features/nodes/observability-access";

describe("resolveObservabilityAccess", () => {
  it("is unwired when both values are absent", () => {
    expect(
      resolveObservabilityAccess({
        grafanaUrl: undefined,
        viewerToken: undefined,
      })
    ).toEqual({ status: "unwired" });
  });

  it("is unwired when only the url is set (no partial credential)", () => {
    expect(
      resolveObservabilityAccess({
        grafanaUrl: "https://stack.grafana.net",
        viewerToken: undefined,
      })
    ).toEqual({ status: "unwired" });
  });

  it("is unwired when only the token is set", () => {
    expect(
      resolveObservabilityAccess({
        grafanaUrl: undefined,
        viewerToken: "glsa_secret",
      })
    ).toEqual({ status: "unwired" });
  });

  it("grants a shared-env Viewer credential when both are present", () => {
    const access = resolveObservabilityAccess({
      grafanaUrl: "https://stack.grafana.net",
      viewerToken: "glsa_secret",
    });
    expect(access).toEqual({
      status: "granted",
      grafanaUrl: "https://stack.grafana.net",
      token: "glsa_secret",
      scope: "shared-env-viewer",
      isolation: "none-shared-env",
      caveat: SHARED_ENV_CAVEAT,
    });
  });

  it("discloses the env-wide breach-line in the caveat (not node-scoped)", () => {
    const access = resolveObservabilityAccess({
      grafanaUrl: "https://stack.grafana.net",
      viewerToken: "glsa_secret",
    });
    expect(access.status).toBe("granted");
    expect(SHARED_ENV_CAVEAT).toMatch(/NOT node-scoped/);
    expect(SHARED_ENV_CAVEAT).toMatch(/every node's logs/i);
  });
});
