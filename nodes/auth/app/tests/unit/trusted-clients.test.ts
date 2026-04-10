// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/trusted-clients`
 * Purpose: Verify auth hub trusted-client bootstrap config for local first-party nodes.
 * Scope: Tests auth hub env parsing and deterministic client credential generation. Does not hit HTTP routes.
 * Invariants: Three local clients exist; redirect URIs match node callbacks; bootstrap credentials are deterministic.
 * Side-effects: process.env
 * @public
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubAuthHubEnv() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_HUB_BASE_URL", "http://localhost:3400/api/auth");
  vi.stubEnv("AUTH_HUB_SECRET", "test-auth-hub-secret-at-least-32-characters");
  vi.stubEnv(
    "AUTH_DATABASE_URL",
    "postgresql://app_service:service_password@localhost:55432/cogni_auth_test"
  );
  vi.stubEnv("AUTH_GITHUB_CLIENT_ID", "test-github-client-id");
  vi.stubEnv("AUTH_GITHUB_CLIENT_SECRET", "test-github-client-secret");
  vi.stubEnv("AUTH_HUB_CLIENT_ID", "cogni-operator-local-test");
  vi.stubEnv(
    "AUTH_HUB_CLIENT_SECRET",
    "operator-local-test-client-secret-32ch"
  );
  vi.stubEnv("AUTH_HUB_CLIENT_ID_POLY", "cogni-poly-local-test");
  vi.stubEnv(
    "AUTH_HUB_CLIENT_SECRET_POLY",
    "poly-local-test-client-secret-32chars"
  );
  vi.stubEnv("AUTH_HUB_CLIENT_ID_RESY", "cogni-resy-local-test");
  vi.stubEnv(
    "AUTH_HUB_CLIENT_SECRET_RESY",
    "resy-local-test-client-secret-32chars"
  );
}

describe("trusted auth hub clients", () => {
  beforeEach(() => {
    vi.resetModules();
    stubAuthHubEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defines one first-party client per local node origin", async () => {
    const { getTrustedAuthHubClients } = await import(
      "../../src/lib/trusted-clients"
    );

    const clients = getTrustedAuthHubClients();

    expect(clients).toHaveLength(3);
    expect(clients.map((client) => client.clientId)).toEqual([
      "cogni-operator-local-test",
      "cogni-poly-local-test",
      "cogni-resy-local-test",
    ]);
    expect(clients.map((client) => client.redirectUrls[0])).toEqual([
      "http://localhost:3000/api/auth/callback/github",
      "http://localhost:3100/api/auth/callback/github",
      "http://localhost:3300/api/auth/callback/github",
    ]);
    expect(new Set(clients.map((client) => client.clientId)).size).toBe(3);
  });

  it("returns deterministic credentials while bootstrapping a client", async () => {
    const {
      generateTrustedClientId,
      generateTrustedClientSecret,
      getTrustedAuthHubClients,
      withPendingTrustedClient,
    } = await import("../../src/lib/trusted-clients");

    const client = getTrustedAuthHubClients()[1];
    await withPendingTrustedClient(client, async () => {
      expect(generateTrustedClientId()).toBe(client.clientId);
      expect(generateTrustedClientSecret()).toBe(client.clientSecret);
    });

    expect(() => generateTrustedClientId()).toThrow(
      "Attempted to generate an auth hub client credential without an active client bootstrap."
    );
  });
});
