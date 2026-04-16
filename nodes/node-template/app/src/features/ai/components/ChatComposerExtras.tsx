// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/chat/components/ChatComposerExtras`
 * Purpose: Provides composer toolbar extras for chat including model selection, graph selection, and voice input.
 * Scope: Smart component managing model selection state, localStorage persistence, and API data synchronization. Does not implement model fetching or localStorage utilities (delegates to hooks and preferences module).
 * Invariants: Validates localStorage preference against API models.
 * Side-effects: global (localStorage via preferences module), IO (API fetch via useModels/useAgents hooks)
 * Notes: Designed to be passed as composerLeft slot to kit Thread.
 * Links: ModelPicker component, GraphPicker component, useModels hook, useAgents hook, model-preference module
 * @public
 */

"use client";

import type { GraphId, ModelRef } from "@cogni/ai-core";
import { useEffect, useMemo, useState } from "react";
import { GraphPicker } from "@/features/ai/components/GraphPicker";
import {
  CHATGPT_MODELS,
  ModelPicker,
} from "@/features/ai/components/ModelPicker";
import { useAgents } from "@/features/ai/hooks/useAgents";
import { useModels } from "@/features/ai/hooks/useModels";
import {
  setPreferredModelId,
  validatePreferredModel,
} from "@/features/ai/preferences/model-preference";

export interface ChatComposerExtrasProps {
  selectedModel: string;
  onModelChange: (ref: ModelRef) => void;
  defaultModelId: string;
  balance?: number;
  selectedGraph?: GraphId;
  onGraphChange?: (graphId: GraphId) => void;
}

export function ChatComposerExtras({
  selectedModel,
  onModelChange,
  defaultModelId,
  balance = 0,
  selectedGraph,
  onGraphChange,
}: Readonly<ChatComposerExtrasProps>) {
  const modelsQuery = useModels();
  const agentsQuery = useAgents();
  const [localModel, setLocalModel] = useState(selectedModel);

  const graphOptions = useMemo(
    () =>
      agentsQuery.data?.agents.map((agent) => ({
        graphId: agent.graphId,
        name: agent.name,
        description: agent.description,
      })) ?? [],
    [agentsQuery.data]
  );

  // Initialize from localStorage on mount, validate against API models
  useEffect(() => {
    if (modelsQuery.data) {
      // Valid model IDs = OpenRouter models + ChatGPT subscription models
      const modelIds = [
        ...modelsQuery.data.models.map((m) => m.ref.modelId),
        ...CHATGPT_MODELS.map((m) => m.id),
      ];
      const validated = validatePreferredModel(modelIds, defaultModelId);
      if (validated !== localModel) {
        setLocalModel(validated);
        // Find the matching ref from API models (defaults to platform provider)
        const matchedModel = modelsQuery.data.models.find(
          (m) => m.ref.modelId === validated
        );
        onModelChange(
          matchedModel?.ref ?? { providerKey: "platform", modelId: validated }
        );
      }
    }
  }, [modelsQuery.data, defaultModelId, localModel, onModelChange]);

  const handleModelChange = (ref: ModelRef) => {
    setLocalModel(ref.modelId);
    setPreferredModelId(ref.modelId);
    onModelChange(ref);
  };

  const handleGraphChange = (graphId: GraphId) => {
    onGraphChange?.(graphId);
  };

  return (
    <div className="flex items-center gap-1">
      <ModelPicker
        models={modelsQuery.data?.models ?? []}
        value={localModel}
        onValueChange={handleModelChange}
        disabled={modelsQuery.isLoading || modelsQuery.isError}
        balance={balance}
      />
      <GraphPicker
        graphs={graphOptions}
        value={selectedGraph ?? null}
        onValueChange={handleGraphChange}
        disabled={!onGraphChange || (agentsQuery.isError && !agentsQuery.data)}
        isLoading={agentsQuery.isPending && !agentsQuery.data}
      />
    </div>
  );
}
