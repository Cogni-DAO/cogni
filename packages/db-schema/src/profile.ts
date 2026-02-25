// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/profile`
 * Purpose: User profile and settings tables — user-controlled display preferences.
 * Scope: Defines user_profiles (display identity) and user_settings (private prefs). Does not contain queries or business logic.
 * Invariants:
 * - PROFILE_1_TO_1: user_profiles.user_id is PK and FK to users.id (exactly one profile per user).
 * - SETTINGS_1_TO_1: user_settings.user_id is PK and FK to users.id (exactly one settings row per user).
 * - DISPLAY_NAME_FALLBACK: display_name is nullable; display logic applies fallback chain (profile → binding → wallet truncation).
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
export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  displayName: text("display_name"),
  avatarColor: text("avatar_color"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * User settings — private user preferences.
 * 1:1 with users table. Theme and other non-display preferences.
 */
export const userSettings = pgTable(
  "user_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    theme: text("theme"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "user_settings_theme_check",
      sql`${table.theme} IS NULL OR ${table.theme} IN ('light', 'dark', 'system')`
    ),
  ]
);
