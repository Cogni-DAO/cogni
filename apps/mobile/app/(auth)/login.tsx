// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";

/** Placeholder login screen — real OAuth implementation in task.0266. */
export default function LoginScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <Text className="text-3xl font-bold text-white mb-2">Cogni</Text>
      <Text className="text-muted text-base mb-10">
        Connect to your AI nodes
      </Text>

      <Pressable
        className="w-full bg-primary rounded-xl py-4 items-center active:opacity-80"
        onPress={() => {
          // TODO(task.0266): real OAuth flow
          router.replace("/(app)/chat");
        }}
      >
        <Text className="text-white font-semibold text-base">
          Sign in with GitHub
        </Text>
      </Pressable>

      <Pressable
        className="w-full border border-border rounded-xl py-4 items-center mt-3 active:opacity-80"
        onPress={() => {
          router.replace("/(app)/chat");
        }}
      >
        <Text className="text-white font-semibold text-base">
          Sign in with Google
        </Text>
      </Pressable>
    </View>
  );
}
