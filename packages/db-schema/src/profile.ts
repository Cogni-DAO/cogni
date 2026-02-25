// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/profile`
 * Purpose: User profile table — user-controlled display preferences.
 * Scope: Defines user_profiles (display identity). Does not contain queries or business logic.
 * Invariants:
 * - PROFILE_1_TO_1: user_profiles.user_id is PK and FK to users.id (exactly one profile per user).
 * - DISPLAY_NAME_FALLBACK: display_name is nullable; display logic applies fallback chain (profile → binding → wallet truncation).
 * - DISPLAY_NAME_MAX_50: CHECK constraint enforces char_length(display_name) ≤ 50.
 * - AVATAR_COLOR_HEX: CHECK constraint enforces avatar_color matches ^#[0-9a-fA-F]{6}$.
 * - RLS_ENABLED: Row-level security enabled on user_profiles.
 * Side-effects: none (schema definitions only)
 * Links: src/contracts/users.profile.v1.contract.ts
 * @public
 */

import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { users } from "./refs";

/**
 * User profiles — user-controlled display identity.
 * 1:1 with users table. Canonical source for display name and avatar color.
 */
export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    displayName: text("display_name"),
    avatarColor: text("avatar_color"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "user_profiles_display_name_length",
      sql`char_length(${table.displayName}) <= 50`
    ),
    check(
      "user_profiles_avatar_color_hex",
      sql`${table.avatarColor} ~ '^#[0-9a-fA-F]{6}$'`
    ),
  ]
).enableRLS();
