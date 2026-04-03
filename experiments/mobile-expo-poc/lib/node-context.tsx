// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { createContext, useContext, useState, type ReactNode } from "react";

export interface CogniNode {
  /** Display name (e.g., "Cogni Operator") */
  name: string;
  /** Base API URL (e.g., "https://operator.cogni.dev") */
  url: string;
  /** Theme accent color (hex) */
  themeColor: string;
}

interface NodeContextValue {
  activeNode: CogniNode;
  nodes: CogniNode[];
  switchNode: (url: string) => void;
  addNode: (node: CogniNode) => void;
  removeNode: (url: string) => void;
}

const DEFAULT_NODE: CogniNode = {
  name: "Cogni Operator",
  url: "https://operator.cogni.dev",
  themeColor: "#6366f1",
};

const NodeContext = createContext<NodeContextValue | null>(null);

export function NodeProvider({ children }: { children: ReactNode }) {
  // TODO(task.0268): persist to AsyncStorage
  const [nodes, setNodes] = useState<CogniNode[]>([DEFAULT_NODE]);
  const [activeUrl, setActiveUrl] = useState(DEFAULT_NODE.url);

  const activeNode = nodes.find((n) => n.url === activeUrl) ?? DEFAULT_NODE;

  const switchNode = (url: string) => {
    if (nodes.some((n) => n.url === url)) {
      setActiveUrl(url);
    }
  };

  const addNode = (node: CogniNode) => {
    setNodes((prev) => {
      if (prev.some((n) => n.url === node.url)) return prev;
      return [...prev, node];
    });
  };

  const removeNode = (url: string) => {
    if (url === DEFAULT_NODE.url) return; // can't remove default
    setNodes((prev) => prev.filter((n) => n.url !== url));
    if (activeUrl === url) setActiveUrl(DEFAULT_NODE.url);
  };

  return (
    <NodeContext.Provider
      value={{ activeNode, nodes, switchNode, addNode, removeNode }}
    >
      {children}
    </NodeContext.Provider>
  );
}

export function useNode(): NodeContextValue {
  const ctx = useContext(NodeContext);
  if (!ctx) throw new Error("useNode must be used within <NodeProvider>");
  return ctx;
}
