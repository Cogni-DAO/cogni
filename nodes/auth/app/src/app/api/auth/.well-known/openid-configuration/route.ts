// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";

import { auth } from "../../../../../lib/auth";

export const runtime = "nodejs";

export const GET = oauthProviderOpenIdConfigMetadata(auth);
