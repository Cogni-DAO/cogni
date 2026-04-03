// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { NodeProvider } from "@/lib/node-context";

export default function RootLayout() {
  return (
    <NodeProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#0a0a0a" },
        }}
      />
    </NodeProvider>
  );
}
