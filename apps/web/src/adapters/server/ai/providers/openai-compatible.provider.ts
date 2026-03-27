// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/providers/openai-compatible.provider`
 * Purpose: ModelProviderPort for user-hosted OpenAI-compatible endpoints (Ollama, vLLM, llama.cpp, LM Studio).
 * Scope: Creates OpenAiCompatibleLlmAdapter from resolved connection. Dynamic model discovery via /v1/models.
 *   All models are user-funded (requiresPlatformCredits = false). Does not handle SSRF validation or credential storage.
 * Invariants:
 *   - requiresPlatformCredits always false (user-funded compute)
 *   - requiresConnection always true (needs endpoint URL)
 *   - DYNAMIC_MODEL_DISCOVERY: models fetched from user endpoint, not hardcoded
 * Side-effects: IO (HTTP to user endpoint for model discovery)
 * Links: docs/spec/multi-provider-llm.md
 * @internal
 */

import type { ModelRef } from "@cogni/ai-core";
import type {
  LlmService,
  ModelOption,
  ModelProviderPort,
  ProviderContext,
  ResolvedConnection,
} from "@/ports";
import { makeLogger } from "@/shared/observability";
import { OpenAiCompatibleLlmAdapter } from "../openai-compatible/openai-compatible-llm.adapter";

const log = makeLogger({ module: "openai-compatible-provider" });

/** Extract baseUrl and apiKey from a resolved connection's credential blob. */
function connectionToEndpoint(conn: ResolvedConnection): {
  baseUrl: string;
  apiKey?: string | undefined;
} {
  // For openai-compatible connections, accessToken holds the base URL
  // and accountId holds the optional API key (reusing existing credential shape).
  // TODO: When connections support custom credential schemas, use proper fields.
  return {
    baseUrl: conn.credentials.accessToken,
    apiKey: conn.credentials.accountId || undefined,
  };
}

export class OpenAiCompatibleModelProvider implements ModelProviderPort {
  readonly providerKey = "openai-compatible" as const;
  readonly usageSource = "ollama" as const;
  readonly requiresConnection = true;

  async listModels(_ctx: ProviderContext): Promise<ModelOption[]> {
    // TODO: Discover models from user's endpoint via GET /v1/models.
    // Requires resolving the user's connection first (needs connectionId from ctx).
    // For now, return empty — models show up after connection is established
    // and the user selects from the connection-specific model list.
    return [];
  }

  createLlmService(connection?: ResolvedConnection): LlmService {
    if (!connection) {
      throw new Error(
        "OpenAiCompatibleModelProvider.createLlmService requires a resolved connection"
      );
    }
    const endpoint = connectionToEndpoint(connection);
    log.info(
      { provider: connection.provider, hasApiKey: !!endpoint.apiKey },
      "Creating OpenAI-compatible adapter"
    );
    return new OpenAiCompatibleLlmAdapter(endpoint);
  }

  async requiresPlatformCredits(_ref: ModelRef): Promise<boolean> {
    return false; // User-funded compute
  }
}
