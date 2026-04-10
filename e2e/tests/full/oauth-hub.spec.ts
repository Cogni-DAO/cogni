// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@e2e/oauth-hub`
 * Purpose: Validates that each local node routes GitHub sign-in through the centralized auth hub.
 * Scope: Covers live browser redirects from operator/poly/resy into the auth hub and onward to GitHub; does not complete the external GitHub callback.
 * Invariants: Each node must use its own OAuth client and callback while sharing one auth hub issuer.
 * Side-effects: IO, time, global
 * Notes: Uses real local NextAuth kickoff + auth hub UI, but stops at GitHub login without completing the external callback.
 * Links: playwright.config.ts, nodes/auth/app/src/lib/auth.ts
 * @internal
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

interface LocalDeployment {
  readonly name: "operator" | "poly" | "resy";
  readonly origin: string;
  readonly clientId: string;
  readonly redirectUri: string;
}

const localDeployments: readonly LocalDeployment[] = [
  {
    name: "operator",
    origin: "http://localhost:3000",
    clientId: "cogni-operator-local",
    redirectUri: "http://localhost:3000/api/auth/callback/github",
  },
  {
    name: "poly",
    origin: "http://localhost:3100",
    clientId: "cogni-poly-local",
    redirectUri: "http://localhost:3100/api/auth/callback/github",
  },
  {
    name: "resy",
    origin: "http://localhost:3300",
    clientId: "cogni-resy-local",
    redirectUri: "http://localhost:3300/api/auth/callback/github",
  },
];

async function createAuthHubAuthorizeUrl(
  request: APIRequestContext,
  deployment: LocalDeployment
): Promise<string> {
  const csrfResponse = await request.get(`${deployment.origin}/api/auth/csrf`);
  expect(csrfResponse.ok()).toBeTruthy();

  const csrfJson = (await csrfResponse.json()) as {
    csrfToken: string;
  };

  const signInResponse = await request.post(
    `${deployment.origin}/api/auth/signin/github?callbackUrl=%2Fchat`,
    {
      form: {
        csrfToken: csrfJson.csrfToken,
        json: "true",
      },
    }
  );
  expect(signInResponse.ok()).toBeTruthy();

  const signInJson = (await signInResponse.json()) as { url: string };
  return signInJson.url;
}

for (const deployment of localDeployments) {
  test(`${deployment.name} routes GitHub sign-in through the shared auth hub`, async ({
    page,
    request,
  }) => {
    const authorizeUrl = await createAuthHubAuthorizeUrl(request, deployment);
    const hubUrl = new URL(authorizeUrl);

    expect(`${hubUrl.origin}${hubUrl.pathname}`).toBe(
      "http://localhost:3400/api/auth/oauth2/authorize"
    );
    expect(hubUrl.searchParams.get("client_id")).toBe(deployment.clientId);
    expect(hubUrl.searchParams.get("redirect_uri")).toBe(deployment.redirectUri);
    expect(new URL(deployment.redirectUri).origin).toBe(deployment.origin);
    expect(hubUrl.searchParams.get("scope")).toBe(
      "openid profile email offline_access"
    );
    expect(hubUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(hubUrl.searchParams.get("nonce")).toBeTruthy();

    await page.goto(authorizeUrl);
    await expect(
      page.getByRole("heading", { name: "Sign in with GitHub" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with GitHub" })
    ).toBeVisible();

    await Promise.all([
      page.waitForURL(/https:\/\/github\.com\/login(\/oauth\/authorize)?/),
      page.getByRole("button", { name: "Continue with GitHub" }).click(),
    ]);

    const githubUrl = new URL(page.url());
    expect(githubUrl.origin).toBe("https://github.com");

    const githubAuthorizeUrl =
      githubUrl.pathname === "/login/oauth/authorize"
        ? githubUrl
        : new URL(githubUrl.searchParams.get("return_to")!, "https://github.com");

    expect(githubAuthorizeUrl.pathname).toBe("/login/oauth/authorize");
    expect(githubAuthorizeUrl.searchParams.get("client_id")).toBeTruthy();

    const githubRedirectUri = githubAuthorizeUrl.searchParams.get("redirect_uri");
    expect(githubRedirectUri).toBeTruthy();
    expect(githubRedirectUri).toContain("http://localhost:3400");
    expect(githubRedirectUri).toContain("/callback/github");
  });
}
