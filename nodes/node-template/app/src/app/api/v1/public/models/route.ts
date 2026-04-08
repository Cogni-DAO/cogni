// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/public/models`
 * Purpose: Public endpoint listing available LLM models — no auth required.
 * Scope: Proxies GET /models from the LiteLLM proxy and returns the model list.
 *   Agents use this to discover which model strings are valid before calling
 *   POST /api/v1/chat/completions.
 * Invariants: Public (no auth); read-only; LITELLM_MASTER_KEY never exposed in response.
 * Side-effects: IO (upstream LiteLLM request)
 * Links: infra/compose/runtime/configs/litellm.config.yaml (model definitions)
 * @public
 */

import { NextResponse } from "next/server";
import { wrapPublicRoute } from "@/bootstrap/http";
import { serverEnv } from "@/shared/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = wrapPublicRoute(
  {
    routeId: "public.models",
    cacheTtlSeconds: 60,
    staleWhileRevalidateSeconds: 300,
  },
  async (_ctx, _request) => {
    const { LITELLM_BASE_URL, LITELLM_MASTER_KEY } = serverEnv();

    let upstream: Response;
    try {
      upstream = await fetch(`${LITELLM_BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${LITELLM_MASTER_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      return NextResponse.json(
        {
          error: "Model registry temporarily unavailable. Please retry.",
          hint: "See GET /api/v1/public/graphs for available graph_name values.",
        },
        { status: 503 }
      );
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Model registry returned an error. Please retry." },
        { status: 502 }
      );
    }

    const data = (await upstream.json()) as unknown;
    return NextResponse.json(data);
  }
);
