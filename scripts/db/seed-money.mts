#!/usr/bin/env tsx

// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/db/seed-money`
 * Purpose: Gives all dev billing accounts a large credit balance so paid
 * models (e.g. OpenRouter) are usable in local development.
 * Scope: Updates billing_accounts.balance_credits and inserts a credit_ledger
 * entry for each account. Idempotent — re-running tops up to the target balance.
 * Side-effects: IO (database writes, console output)
 * @public
 */

import { randomUUID } from "node:crypto";
import { createServiceDbClient } from "@cogni/db-client/service";
import { billingAccounts, creditLedger, virtualKeys } from "@cogni/db-schema";
import { eq } from "drizzle-orm";

// 100 USD worth of credits (credits are in micro-USD: 1 credit = $0.000001)
const TARGET_BALANCE = 100_000_000n; // $100.00
const SEED_REASON = "dev_seed_money";

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_SERVICE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_SERVICE_URL not set in .env.local");
  }

  console.log("💰 Dev Seed: Credit Balance Top-Up");
  console.log(`   Target balance: $${Number(TARGET_BALANCE) / 1_000_000}`);
  console.log(`   Database: ${dbUrl.replace(/\/\/[^@]+@/, "//***@")}`);
  console.log();

  const db = createServiceDbClient(dbUrl);

  try {
    // Find all billing accounts
    const accounts = await db
      .select({
        id: billingAccounts.id,
        ownerUserId: billingAccounts.ownerUserId,
        balanceCredits: billingAccounts.balanceCredits,
        isSystemTenant: billingAccounts.isSystemTenant,
      })
      .from(billingAccounts);

    if (accounts.length === 0) {
      console.log(
        "⚠️  No billing accounts found. Log in to the app first to create one, then re-run."
      );
      return;
    }

    for (const account of accounts) {
      const currentBalance = account.balanceCredits ?? 0n;
      if (currentBalance >= TARGET_BALANCE) {
        console.log(
          `  ✅ ${account.id.slice(0, 12)}… (${account.isSystemTenant ? "system" : "user"}) — already at $${Number(currentBalance) / 1_000_000} — skipped`
        );
        continue;
      }

      const topUp = TARGET_BALANCE - currentBalance;

      // Get default virtual key for this account
      const [vk] = await db
        .select({ id: virtualKeys.id })
        .from(virtualKeys)
        .where(eq(virtualKeys.billingAccountId, account.id))
        .limit(1);

      if (!vk) {
        console.log(
          `  ⚠️  ${account.id.slice(0, 12)}… — no virtual key found, skipping`
        );
        continue;
      }

      // Insert ledger entry + update cached balance atomically
      await db.transaction(async (tx) => {
        await tx.insert(creditLedger).values({
          id: randomUUID(),
          billingAccountId: account.id,
          virtualKeyId: vk.id,
          amount: topUp,
          balanceAfter: TARGET_BALANCE,
          reason: SEED_REASON,
          reference: `dev-seed-money-${account.id}-${Date.now()}`,
          metadata: { source: "scripts/db/seed-money.mts" },
        });

        await tx
          .update(billingAccounts)
          .set({ balanceCredits: TARGET_BALANCE })
          .where(eq(billingAccounts.id, account.id));
      });

      console.log(
        `  💰 ${account.id.slice(0, 12)}… (${account.isSystemTenant ? "system" : "user"}) — topped up +$${Number(topUp) / 1_000_000} → $${Number(TARGET_BALANCE) / 1_000_000}`
      );
    }

    console.log();
    console.log("✅ Done! All accounts have credits for paid models.");
    console.log(
      "   Make sure OPENROUTER_API_KEY is set in .env.local to use OpenRouter models."
    );
  } finally {
    await db.$client.end();
  }
}

main().catch((error: Error) => {
  console.error("\n💥 Seed money failed:");
  console.error(error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
