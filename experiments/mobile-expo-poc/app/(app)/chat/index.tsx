// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useNode } from "@/lib/node-context";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/**
 * Placeholder chat screen.
 * Real streaming SSE implementation in task.0267.
 */
export default function ChatScreen() {
  const { activeNode } = useNode();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `Connected to ${activeNode.name}. Ready to chat.`,
    },
  ]);
  const [input, setInput] = useState("");

  const sendMessage = () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    // TODO(task.0267): replace with real SSE streaming to /api/v1/ai/chat
    const assistantMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content: `[Placeholder] Streaming from ${activeNode.url} not yet implemented. See task.0267.`,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 12 }}
        renderItem={({ item }) => (
          <View
            className={`mb-3 p-3 rounded-xl max-w-[85%] ${
              item.role === "user"
                ? "bg-primary self-end"
                : "bg-surface self-start"
            }`}
          >
            <Text className="text-white text-base">{item.content}</Text>
          </View>
        )}
      />

      <View className="flex-row items-center px-4 py-3 border-t border-border">
        <TextInput
          className="flex-1 bg-surface text-white rounded-xl px-4 py-3 mr-2 text-base"
          placeholder="Message..."
          placeholderTextColor="#a1a1aa"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
        />
        <Pressable
          className="bg-primary rounded-xl px-5 py-3 active:opacity-80"
          onPress={sendMessage}
        >
          <Text className="text-white font-semibold">Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
