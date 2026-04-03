// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { View, Text, Pressable, ScrollView } from "react-native";
import { useNode } from "@/lib/node-context";

/**
 * Settings screen with node-switcher placeholder.
 * Real node management in task.0268.
 */
export default function SettingsScreen() {
  const { activeNode, nodes } = useNode();

  return (
    <ScrollView className="flex-1 bg-background px-4 pt-4">
      <Text className="text-white text-xl font-bold mb-6">Settings</Text>

      {/* Active node */}
      <View className="bg-surface rounded-xl p-4 mb-4">
        <Text className="text-muted text-xs uppercase tracking-wide mb-2">
          Active Node
        </Text>
        <Text className="text-white text-lg font-semibold">
          {activeNode.name}
        </Text>
        <Text className="text-muted text-sm mt-1">{activeNode.url}</Text>
      </View>

      {/* Node list */}
      <Text className="text-muted text-xs uppercase tracking-wide mb-2">
        Nodes
      </Text>
      {nodes.map((node) => (
        <View
          key={node.url}
          className={`bg-surface rounded-xl p-4 mb-2 border ${
            node.url === activeNode.url ? "border-primary" : "border-border"
          }`}
        >
          <Text className="text-white font-semibold">{node.name}</Text>
          <Text className="text-muted text-sm">{node.url}</Text>
        </View>
      ))}

      {/* Add node placeholder */}
      <Pressable className="border border-dashed border-border rounded-xl p-4 items-center mt-2 active:opacity-80">
        <Text className="text-muted">+ Add Node (task.0268)</Text>
      </Pressable>

      {/* Auth section */}
      <View className="mt-6 bg-surface rounded-xl p-4">
        <Text className="text-muted text-xs uppercase tracking-wide mb-2">
          Account
        </Text>
        <Text className="text-white">Not signed in</Text>
        <Text className="text-muted text-sm mt-1">
          OAuth login coming in task.0266
        </Text>
      </View>
    </ScrollView>
  );
}
