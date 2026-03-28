// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/graph-executor.factory`
 * Purpose: Factory for creating GraphExecutorPort implementations with observability and billing.
 * Scope: Bridges app layer (facades) to adapters layer via bootstrap. Does not contain business logic.
 * Invariants:
 *   - Facade NEVER imports adapters directly (use this factory)
 *   - Per UNIFIED_GRAPH_EXECUTOR: all graph execution flows through GraphExecutorPort
 *   - Per ROUTING_BY_NAMESPACE_ONLY: NamespaceGraphRouter routes by graphId prefix via Map
 *   - Per LANGFUSE_INTEGRATION: ObservabilityGraphExecutorDecorator wraps for Langfuse traces
 *   - Per CALLBACK_WRITES_PLATFORM_RECEIPTS: UsageCommitDecorator validates usage_report events. Platform receipts via LiteLLM callback; BYO receipts committed directly.
 *   - Per CREDITS_ENFORCED_AT_EXECUTION_PORT: PreflightCreditCheckDecorator rejects runs with insufficient credits
 *   - LAZY_SANDBOX_IMPORT: Sandbox provider loaded via dynamic import() to defer dockerode native addon chain (SandboxRunnerAdapter)
 * Side-effects: global (module-scoped cached sandbox provider promise)
 * Links: container.ts, NamespaceGraphRouter, GRAPH_EXECUTION.md, OBSERVABILITY.md
 * @public
 */

import type { SourceSystem, ToolSourcePort } from "@cogni/ai-core";
import type {
  ExecutionContext,
  GraphFinal,
  GraphRunRequest,
  GraphRunResult,
} from "@cogni/graph-execution-core";
import type { UserId } from "@cogni/ids";
import {
  LANGGRAPH_CATALOG,
  loadMcpTools,
  McpToolSource,
  parseMcpConfigFromEnv,
} from "@cogni/langgraph-graphs";
import {
  BillingEnrichmentGraphExecutorDecorator,
  type CompletionStreamFn,
  createLangGraphDevClient,
  InProcCompletionUnitAdapter,
  LangGraphDevProvider,
  LangGraphInProcProvider,
  NamespaceGraphRouter,
  ObservabilityGraphExecutorDecorator,
  PreflightCreditCheckDecorator,
  UsageCommitDecorator,
} from "@/adapters/server";
import { runInScope } from "@/adapters/server/ai/execution-scope";
import type {
  AiExecutionErrorCode,
  BillingContext,
  ConnectionBrokerPort,
  GraphExecutorPort,
  LlmService,
  ModelProviderResolverPort,
  PreflightCreditCheckFn,
} from "@/ports";
import { serverEnv } from "@/shared/env";
import { makeLogger } from "@/shared/observability";
import {
  type AiAdapterDeps,
  getContainer,
  resolveAiAdapterDeps,
} from "./container";

/**
 * Factory for creating NamespaceGraphRouter with all configured providers.
 * Per UNIFIED_GRAPH_EXECUTOR: all graph execution flows through GraphExecutorPort.
 * Per ROUTING_BY_NAMESPACE_ONLY: NamespaceGraphRouter routes by graphId namespace via Map.
 * Per CATALOG_SINGLE_SOURCE_OF_TRUTH: Provider imports catalog from @cogni/langgraph-graphs.
 * Per MUTUAL_EXCLUSION: Register exactly one langgraph provider (InProc XOR Dev) based on env.
 *
 * Architecture boundary: Facade calls this factory (app → bootstrap),
 * factory creates router (bootstrap → adapters). Facade never imports adapters.
 *
 * Static inner executor:
 *   NamespaceGraphRouter
 *
 * @param completionStreamFn - Feature function for LLM streaming (from features/ai)
 * @param userId - User ID for adapter dependency resolution
 * @returns GraphExecutorPort implementation with routing only
 */
export function createGraphExecutor(
  completionStreamFn: CompletionStreamFn,
  userId: UserId
): GraphExecutorPort {
  const deps = resolveAiAdapterDeps(userId);

  // Per MUTUAL_EXCLUSION: choose provider based on LANGGRAPH_DEV_URL env
  const devUrl = serverEnv().LANGGRAPH_DEV_URL;
  const langGraphProvider = devUrl
    ? createDevProvider(devUrl)
    : createInProcProvider(deps, completionStreamFn);

  // Build namespace → provider map
  const env = serverEnv();
  const providers = new Map<string, GraphExecutorPort>([
    [langGraphProvider.providerId, langGraphProvider],
    [
      "sandbox",
      new LazySandboxGraphProvider(
        env.LITELLM_MASTER_KEY,
        env.OPENCLAW_GATEWAY_URL,
        env.OPENCLAW_GATEWAY_TOKEN
      ),
    ],
  ]);

  // Create namespace router with all configured providers
  const router = new NamespaceGraphRouter(providers);

  return router;
}

/**
 * Compose a per-run scoped executor.
 *
 * Bootstrap owns per-run wrapper composition so launchers do not construct ad hoc
 * scoped executors in facades or routes.
 *
 * Provider resolution happens here: the ModelProviderResolverPort resolves the
 * LlmService from req.modelRef BEFORE execution starts. No more llmServiceOverride
 * via AsyncLocalStorage — the resolved LlmService is set on the execution scope.
 */
export function createScopedGraphExecutor(params: {
  readonly executor: GraphExecutorPort;
  readonly billing: BillingContext;
  readonly preflightCheckFn: PreflightCreditCheckFn;
  readonly commitByoUsage: import("@/adapters/server/ai/usage-commit.decorator").CommitUsageFactFn;
  readonly abortSignal?: AbortSignal;
  readonly broker?: ConnectionBrokerPort;
  readonly resolver: ModelProviderResolverPort;
  readonly actorId: string;
}): GraphExecutorPort {
  const container = getContainer();

  const enriched = new BillingEnrichmentGraphExecutorDecorator(
    params.executor,
    params.billing
  );

  // Validate usage_report events; commit BYO receipts directly, defer platform to callback.
  const billed = new UsageCommitDecorator(
    enriched,
    container.log,
    params.commitByoUsage
  );

  // Wrap with preflight credit check — uses provider resolver for billing policy
  const preflighted = new PreflightCreditCheckDecorator(
    billed,
    params.preflightCheckFn,
    params.billing.billingAccountId,
    params.resolver,
    container.log
  );

  // Wrap with observability decorator for Langfuse traces (outermost)
  const observed = new ObservabilityGraphExecutorDecorator(
    preflighted,
    container.langfuse,
    { finalizationTimeoutMs: 15_000 },
    container.log,
    params.billing.billingAccountId
  );

  return {
    runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
      // Resolve LlmService from provider BEFORE execution
      const provider = params.resolver.resolve(req.modelRef.providerKey);

      // Fail fast: connection-required providers must have connectionId + broker
      if (provider.requiresConnection) {
        if (!req.modelRef.connectionId) {
          throw new Error(
            `Provider "${req.modelRef.providerKey}" requires a connection but modelRef.connectionId is missing. ` +
              `Ensure the model picker sends connectionId and the status endpoint returns it.`
          );
        }
        if (!params.broker) {
          throw new Error(
            `Provider "${req.modelRef.providerKey}" requires a connection but ConnectionBroker is not configured. ` +
              `Set CONNECTIONS_ENCRYPTION_KEY to enable BYO-AI.`
          );
        }
      }

      if (
        provider.requiresConnection &&
        req.modelRef.connectionId &&
        params.broker
      ) {
        // BYO path: resolve credentials async, then run graph with provider's LlmService.
        const broker = params.broker;
        const connectionId = req.modelRef.connectionId;
        let innerResult: GraphRunResult | undefined;
        let resolveOuterFinal: ((v: GraphFinal) => void) | undefined;
        const outerFinal = new Promise<GraphFinal>((r) => {
          resolveOuterFinal = r;
        });

        const stream = (async function* () {
          let llmService: LlmService;
          try {
            const connection = await broker.resolve(connectionId, {
              actorId: params.actorId,
              tenantId: params.billing.billingAccountId,
            });
            llmService = provider.createLlmService(connection);
          } catch (err) {
            container.log.error(
              {
                connectionId,
                error: err instanceof Error ? err.message : String(err),
              },
              "Connection resolution failed"
            );
            yield {
              type: "error" as const,
              error:
                "internal" as import("@cogni/ai-core").AiExecutionErrorCode,
            };
            yield { type: "done" as const };
            // biome-ignore lint/style/noNonNullAssertion: assigned synchronously in Promise constructor
            resolveOuterFinal!({
              ok: false,
              runId: req.runId,
              requestId: ctx?.requestId ?? req.runId,
              error:
                "internal" as import("@cogni/ai-core").AiExecutionErrorCode,
            });
            return;
          }

          innerResult = runGraphWithScope({
            executor: observed,
            req,
            ...(ctx ? { ctx } : {}),
            billing: params.billing,
            llmService,
            usageSource: provider.usageSource,
            ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
          });

          yield* innerResult.stream;
          const f = await innerResult.final;
          // biome-ignore lint/style/noNonNullAssertion: assigned synchronously in Promise constructor
          resolveOuterFinal!(f);
        })();

        return { stream, final: outerFinal };
      }

      // Standard path: use provider's LlmService (no connection needed)
      const llmService = provider.createLlmService();
      return runGraphWithScope({
        executor: observed,
        req,
        ...(ctx ? { ctx } : {}),
        billing: params.billing,
        llmService,
        usageSource: provider.usageSource,
        ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
      });
    },
  };
}

/**
 * Run a graph within an execution scope.
 *
 * This is the ONLY app-local launch entrypoint. Every launcher (chat, schedule,
 * webhook, review) calls this — never executor.runGraph() directly.
 *
 * Sets AsyncLocalStorage scope so static inner providers can read billing context
 * and the resolved LlmService.
 */
export function runGraphWithScope(params: {
  readonly executor: GraphExecutorPort;
  readonly req: GraphRunRequest;
  readonly ctx?: ExecutionContext;
  readonly billing: BillingContext;
  readonly llmService: LlmService;
  readonly usageSource: SourceSystem;
  readonly abortSignal?: AbortSignal;
}): GraphRunResult {
  const { executor, req, ctx, billing, llmService, usageSource } = params;
  return runInScope(
    {
      billing,
      llmService,
      usageSource,
      ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
    },
    () => executor.runGraph(req, ctx)
  );
}

// ---------------------------------------------------------------------------
// MCP tool source — cached singleton, loaded on first use
// ---------------------------------------------------------------------------

const mcpLog = makeLogger({ component: "mcp-bootstrap" });

/** Module-scoped cache for MCP tool source + close function */
let _mcpState: {
  sourcePromise: Promise<ToolSourcePort | null>;
  close: (() => Promise<void>) | null;
} | null = null;

/**
 * Get or create the MCP tool source singleton.
 * Returns null if no MCP servers are configured.
 */
function getMcpToolSource(): Promise<ToolSourcePort | null> {
  if (!_mcpState) {
    const config = parseMcpConfigFromEnv();
    const serverNames = Object.keys(config);
    if (serverNames.length === 0) {
      mcpLog.debug(
        "No MCP servers configured (set MCP_SERVERS or MCP_CONFIG_PATH env)"
      );
      _mcpState = { sourcePromise: Promise.resolve(null), close: null };
    } else {
      mcpLog.info(
        { servers: serverNames },
        "Loading MCP tools from configured servers"
      );
      const resultPromise = loadMcpTools(config);

      _mcpState = {
        sourcePromise: resultPromise
          .then((result) => {
            // Store close function for lifecycle management
            if (_mcpState) _mcpState.close = result.close;
            const source = new McpToolSource(result.tools);
            mcpLog.info(
              {
                toolCount: result.tools.length,
                toolNames: result.tools.map((t) => t.name),
              },
              "MCP tools loaded successfully"
            );
            return source;
          })
          .catch((err) => {
            mcpLog.error(
              { err },
              "Failed to load MCP tools; continuing without them"
            );
            return null;
          }),
        close: null,
      };
    }
  }
  return _mcpState.sourcePromise;
}

/**
 * Close all MCP server connections. Call on process shutdown.
 * Prevents orphaned stdio subprocesses.
 */
export async function closeMcpConnections(): Promise<void> {
  if (_mcpState?.close) {
    mcpLog.info("Closing MCP server connections");
    try {
      await _mcpState.close();
    } catch (err) {
      mcpLog.error({ err }, "Error closing MCP connections");
    }
  }
  _mcpState = null;
}

/**
 * Create InProc provider for in-process graph execution.
 * Per CAPABILITY_INJECTION: toolSource contains real implementations with I/O.
 * MCP tools are loaded lazily via McpToolSource and passed to the provider.
 */
function createInProcProvider(
  deps: AiAdapterDeps,
  completionStreamFn: CompletionStreamFn
): GraphExecutorPort {
  const container = getContainer();
  const inprocAdapter = new InProcCompletionUnitAdapter(
    deps,
    completionStreamFn
  );

  // Load MCP tools async. Wrap provider so first runGraph() awaits MCP loading.
  const mcpSourcePromise = getMcpToolSource();
  return new LazyMcpInProcProvider(
    inprocAdapter,
    container.toolSource,
    mcpSourcePromise
  );
}

/**
 * Create Dev provider for langgraph dev server execution.
 * Per MVP_DEV_ONLY: connects to langgraph dev (port 2024).
 */
function createDevProvider(apiUrl: string): LangGraphDevProvider {
  const client = createLangGraphDevClient({ apiUrl });
  const availableGraphs = Object.keys(LANGGRAPH_CATALOG);
  return new LangGraphDevProvider(client, { availableGraphs });
}

// ---------------------------------------------------------------------------
// Lazy MCP provider — defers MCP tool source loading to first runGraph() call
// ---------------------------------------------------------------------------

/**
 * Wraps LangGraphInProcProvider construction behind an async boundary.
 * On first runGraph(), awaits MCP tool source loading, constructs the real
 * provider with the source, then delegates. Subsequent calls use the cached provider.
 */
class LazyMcpInProcProvider implements GraphExecutorPort {
  readonly providerId = "langgraph" as const;
  private resolvedProvider: LangGraphInProcProvider | null = null;
  private readonly providerPromise: Promise<LangGraphInProcProvider>;

  constructor(
    adapter: import("@/adapters/server/ai/langgraph/inproc.provider").CompletionUnitAdapter,
    toolSource: ToolSourcePort,
    mcpSourcePromise: Promise<ToolSourcePort | null>
  ) {
    this.providerPromise = mcpSourcePromise.then((mcpSource) => {
      const provider = new LangGraphInProcProvider(
        adapter,
        toolSource,
        mcpSource ?? undefined
      );
      this.resolvedProvider = provider;
      return provider;
    });
  }

  runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
    // Fast path: provider already resolved
    if (this.resolvedProvider) {
      return this.resolvedProvider.runGraph(req, ctx);
    }

    // Slow path (first call): await provider construction
    const innerResult = this.providerPromise.then((p) => p.runGraph(req, ctx));

    const stream = (async function* () {
      let inner: GraphRunResult;
      try {
        inner = await innerResult;
      } catch {
        yield {
          type: "error" as const,
          error: "internal" as AiExecutionErrorCode,
        };
        yield { type: "done" as const };
        return;
      }
      yield* inner.stream;
    })();

    const final = innerResult.then(
      (r) => r.final,
      () =>
        ({
          ok: false as const,
          runId: req.runId,
          requestId: ctx?.requestId ?? req.runId,
          error: "internal",
        }) as const
    );

    return { stream, final };
  }
}

// ---------------------------------------------------------------------------
// Lazy sandbox provider — defers dockerode import to first runGraph() call
// ---------------------------------------------------------------------------

/** Module-scoped singleton: caches the dynamic import + provider construction */
let _sandboxProvider: Promise<GraphExecutorPort> | null = null;

function loadSandboxProvider(
  litellmMasterKey: string,
  gatewayUrl: string,
  gatewayToken: string
): Promise<GraphExecutorPort> {
  if (!_sandboxProvider) {
    _sandboxProvider = import("@/adapters/server/sandbox").then(
      ({
        SandboxRunnerAdapter,
        SandboxGraphProvider,
        OpenClawGatewayClient,
      }) => {
        const runner = new SandboxRunnerAdapter({ litellmMasterKey });

        // Gateway client for OpenClaw gateway mode
        // Billing: handled by LiteLLM generic_api callback (NO_ZERO_RECEIPTS_FOR_PAID_MODELS)
        const gatewayClient = new OpenClawGatewayClient(
          gatewayUrl,
          gatewayToken
        );

        return new SandboxGraphProvider(
          runner,
          gatewayClient
        ) as GraphExecutorPort;
      }
    );
  }
  return _sandboxProvider;
}

/**
 * GraphExecutorPort that lazy-loads SandboxGraphProvider on first use.
 *
 * Avoids top-level import of dockerode → ssh2 → cpu-features (native addon)
 * which breaks Turbopack bundling when the barrel re-exports it.
 *
 * Per LAZY_SANDBOX_IMPORT: runGraph() returns {stream, final} synchronously;
 * the async generator inside awaits the cached import before delegating.
 */
class LazySandboxGraphProvider implements GraphExecutorPort {
  private readonly delegate: Promise<GraphExecutorPort>;

  constructor(
    litellmMasterKey: string,
    gatewayUrl: string,
    gatewayToken: string
  ) {
    this.delegate = loadSandboxProvider(
      litellmMasterKey,
      gatewayUrl,
      gatewayToken
    );
  }

  runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
    const delegate = this.delegate;

    // Shared promise: resolves to delegate's runGraph result once module loads
    const innerResult = delegate.then((p) => p.runGraph(req, ctx));

    const stream = (async function* () {
      let inner: GraphRunResult;
      try {
        inner = await innerResult;
      } catch {
        yield {
          type: "error" as const,
          error: "internal" as AiExecutionErrorCode,
        };
        yield { type: "done" as const };
        return;
      }
      yield* inner.stream;
    })();

    const final = innerResult.then(
      (r) => r.final,
      () =>
        ({
          ok: false,
          runId: req.runId,
          requestId: ctx?.requestId ?? req.runId,
          error: "internal",
        }) as const
    );

    return { stream, final };
  }
}
