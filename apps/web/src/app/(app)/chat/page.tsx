// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/chat/page`
 * Purpose: Server entrypoint for the chat page.
 * Scope: Server component only; delegates all client-side behavior to ChatView. Suspense boundary required for useSearchParams().
 * Invariants: Auth enforced by (app) layout guard.
 * Side-effects: none (server render only)
 * Links: src/app/(app)/chat/view.tsx
 * @public
 */

import type { ReactElement } from "react";
import { Suspense } from "react";

import { getAppDb } from "@/adapters/server/db/drizzle.client";
import { ChatView } from "./view";

async function getChatGptConnectionId(): Promise<string | undefined> {
  try {
    const db = getAppDb();
    const { connections } = await import("@cogni/db-schema");
    const { and, eq, isNull } = await import("drizzle-orm");

    // Find any active chatgpt connection (single-tenant crawl — no user filter needed)
    const rows = await db
      .select({ connectionId: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.provider, "openai-chatgpt"),
          isNull(connections.revokedAt)
        )
      )
      .limit(1);
    return rows[0]?.connectionId;
  } catch {
    return undefined;
  }
}

export default async function ChatPage(): Promise<ReactElement> {
  const chatGptConnectionId = await getChatGptConnectionId();
  return (
    <Suspense>
      <ChatView chatGptConnectionId={chatGptConnectionId} />
    </Suspense>
  );
}
