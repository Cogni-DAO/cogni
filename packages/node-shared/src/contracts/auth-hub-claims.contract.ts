// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-shared/contracts/auth-hub-claims`
 * Purpose: Canonical Zod contracts for Cogni auth-hub claims shared by the hub and node apps.
 * Scope: Pure schemas and constants only. Does not perform token verification or framework-specific parsing.
 * Invariants:
 * - `sub` is the canonical cross-node Cogni user id
 * - Custom claims are namespaced under https://cognidao.org/claims/*
 * - Prototype scope is GitHub-only centralized OAuth
 * Side-effects: none
 * Links: docs/spec/identity-model.md, docs/spec/decentralized-user-identity.md
 * @public
 */

import { z } from "zod";

export const AUTH_HUB_PROVIDER_CLAIM =
  "https://cognidao.org/claims/provider" as const;
export const AUTH_HUB_GITHUB_ID_CLAIM =
  "https://cognidao.org/claims/github_id" as const;
export const AUTH_HUB_GITHUB_LOGIN_CLAIM =
  "https://cognidao.org/claims/github_login" as const;

export const authHubProviderSchema = z.literal("github");

export const authHubClaimsSchema = z.object({
  sub: z.string().uuid(),
  name: z.string().min(1).nullable().optional(),
  email: z.string().email().nullable().optional(),
  picture: z.string().url().nullable().optional(),
  [AUTH_HUB_PROVIDER_CLAIM]: authHubProviderSchema,
  [AUTH_HUB_GITHUB_ID_CLAIM]: z.string().min(1),
  [AUTH_HUB_GITHUB_LOGIN_CLAIM]: z.string().min(1),
});

export type AuthHubClaims = z.infer<typeof authHubClaimsSchema>;
