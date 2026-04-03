// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { Redirect } from "expo-router";

/** Root index — redirect to chat (or auth if not logged in). */
export default function Index() {
  // TODO(task.0266): check auth state, redirect to /(auth)/login if unauthenticated
  return <Redirect href="/(app)/chat" />;
}
