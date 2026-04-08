// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { randomUUID } from "node:crypto";
import { users } from "@cogni/db-schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { registerAgentOperation } from "@cogni/node-contracts";
import { issueAgentApiKey } from "@/app/_lib/auth/request-identity";
import { getContainer, resolveServiceDb } from "@/bootstrap/container";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = registerAgentOperation.input.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const input = parsed.data;

  const db = resolveServiceDb();
  const id = randomUUID();

  await db.insert(users).values({
    id,
    name: input.name,
    walletAddress: null,
  });

  const container = getContainer();
  const billingAccount =
    await container.serviceAccountService.getOrCreateBillingAccountForUser({
      userId: id,
      displayName: input.name,
    });

  const actorId = `user:${id}`;
  const apiKey = issueAgentApiKey({
    userId: id,
    actorId,
    displayName: input.name,
  });

  const persisted = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (persisted.length === 0) {
    return NextResponse.json(
      { error: "Failed to register actor" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    registerAgentOperation.output.parse({
      actorId,
      userId: id,
      apiKey,
      billingAccountId: billingAccount.id,
    }),
    { status: 201 }
  );
}
