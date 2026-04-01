#!/usr/bin/env tsx
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: scripts/dev/billing-callback-router.mts
 * Purpose: Dev-mode LiteLLM callback router — inspects metadata.node_id and forwards
 *   billing callbacks to the correct node's /api/internal/billing/ingest endpoint.
 * Scope: Development only. In production, this becomes an nginx/Caddy route or sidecar.
 * Invariants:
 *   NODE_LOCAL_METERING_PRIMARY: routes to node-local endpoint, never centralizes writes
 *   CALLBACK_AUTHENTICATED: forwards Authorization header as-is
 *   CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID: no dedup logic here — node endpoints handle it
 * Side-effects: IO (HTTP proxy)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";

const PORT = Number(process.env.CALLBACK_ROUTER_PORT ?? "3900");

/** Map node_id → local dev URL */
const NODE_ENDPOINTS: Record<string, string> = {
  operator: "http://localhost:3000/api/internal/billing/ingest",
  poly: "http://localhost:3100/api/internal/billing/ingest",
  resy: "http://localhost:3300/api/internal/billing/ingest",
};

const DEFAULT_NODE = "operator";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function extractNodeId(body: string): string {
  try {
    const payload = JSON.parse(body) as unknown[];
    if (Array.isArray(payload) && payload.length > 0) {
      const first = payload[0] as Record<string, unknown>;
      const metadata = first?.metadata as Record<string, unknown> | undefined;
      const spendLogs = metadata?.spend_logs_metadata as
        | Record<string, unknown>
        | undefined;
      if (typeof spendLogs?.node_id === "string") {
        return spendLogs.node_id;
      }
    }
  } catch {
    // JSON parse failure — fall through to default
  }
  return DEFAULT_NODE;
}

const server = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    const body = await readBody(req);
    const nodeId = extractNodeId(body);
    const target = NODE_ENDPOINTS[nodeId] ?? NODE_ENDPOINTS[DEFAULT_NODE];

    console.log(
      `[callback-router] node_id=${nodeId} → ${target} (${body.length} bytes)`
    );

    try {
      const upstream = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(req.headers.authorization && {
            Authorization: req.headers.authorization,
          }),
        },
        body,
      });

      const responseBody = await upstream.text();
      res.writeHead(upstream.status, {
        "Content-Type": "application/json",
      });
      res.end(responseBody);
    } catch (error) {
      console.error(`[callback-router] Failed to forward to ${target}:`, error);
      res.writeHead(502);
      res.end(JSON.stringify({ error: "Bad Gateway", target, nodeId }));
    }
  }
);

server.listen(PORT, () => {
  console.log(`[callback-router] Listening on :${PORT}`);
  console.log(`[callback-router] Routes:`, NODE_ENDPOINTS);
});
