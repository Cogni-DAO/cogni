// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionUser } from "@cogni/node-shared";
import { headers } from "next/headers";
import { getSessionUser } from "@/app/_lib/auth/session";
import { serverEnv } from "@/shared/env/server";

type AgentTokenPayload = {
  sub: string;
  actorId: string;
  displayName: string | null;
  iat: number;
  exp: number;
};

const TOKEN_PREFIX = "cogni_ag_sk_v1_";
const AGENT_KEY_TTL_SECONDS = 60 * 60 * 24 * 30;

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", serverEnv().AUTH_SECRET)
    .update(payloadB64)
    .digest("base64url");
}

function parseAgentToken(token: string): AgentTokenPayload | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const encoded = token.slice(TOKEN_PREFIX.length);
  const [payloadB64, signature] = encoded.split(".");
  if (!payloadB64 || !signature) return null;
  const expected = signPayload(payloadB64);
  if (!safeCompare(signature, expected)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    ) as AgentTokenPayload;
    if (!parsed.sub || !parsed.actorId) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function issueAgentApiKey(input: {
  userId: string;
  actorId: string;
  displayName: string | null;
}): string {
  const payload: AgentTokenPayload = {
    sub: input.userId,
    actorId: input.actorId,
    displayName: input.displayName,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + AGENT_KEY_TTL_SECONDS,
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  return `${TOKEN_PREFIX}${payloadB64}.${signPayload(payloadB64)}`;
}

function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function resolveRequestIdentity(): Promise<SessionUser | null> {
  let h: Awaited<ReturnType<typeof headers>>;
  try {
    h = await headers();
  } catch {
    return getSessionUser();
  }
  const bearer = extractBearerToken(h.get("authorization"));
  if (bearer) {
    const payload = parseAgentToken(bearer);
    if (!payload) return null;
    return {
      id: payload.sub,
      walletAddress: null,
      displayName: payload.displayName,
      avatarColor: null,
    };
  }

  if (!isSameOrigin(h.get("origin"), h.get("host"))) {
    return null;
  }

  return getSessionUser();
}
