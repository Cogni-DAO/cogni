// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  return NextResponse.json({
    name: "Cogni Node API",
    version: "v1",
    registrationUrl: `${origin}/api/v1/agent/register`,
    auth: { type: "bearer", keyPrefix: "cogni_ag_sk_v1_" },
    endpoints: {
      completions: `${origin}/api/v1/chat/completions`,
      runs: `${origin}/api/v1/agent/runs`,
      runStream: `${origin}/api/v1/agent/runs/{runId}/stream`,
    },
  });
}
