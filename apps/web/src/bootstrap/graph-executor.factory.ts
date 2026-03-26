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
 *   - Per CALLBACK_IS_SOLE_WRITER: BillingGraphExecutorDecorator validates usage_report events (receipt writes via LiteLLM callback)
 *   - Per CREDITS_ENFORCED_AT_EXECUTION_PORT: PreflightCreditCheckDecorator rejects runs with insufficient credits
 *   - LAZY_SANDBOX_IMPORT: Sandbox provider loaded via dynamic import() to defer dockerode native addon chain (SandboxRunnerAdapter)
 * Side-effects: global (module-scoped cached sandbox provider promise)
 * Links: container.ts, NamespaceGraphRouter, GRAPH_EXECUTION.md, OBSERVABILITY.md
 * @public
 */

import type {
  ExecutionContext,
  GraphFinal,
  GraphRunRequest,
  GraphRunResult,
} from "@cogni/graph-execution-core";
import type { UserId } from "@cogni/ids";
import { LANGGRAPH_CATALOG } from "@cogni/langgraph-graphs";
import {
  BillingEnrichmentGraphExecutorDecorator,
  BillingGraphExecutorDecorator,
  type CompletionStreamFn,
  createLangGraphDevClient,
  InProcCompletionUnitAdapter,
  LangGraphDevProvider,
  LangGraphInProcProvider,
  NamespaceGraphRouter,
  ObservabilityGraphExecutorDecorator,
  PreflightCreditCheckDecorator,
} from "@/adapters/server";
import { runInScope } from "@/adapters/server/ai/execution-scope";
import type {
  AiExecutionErrorCode,
  BillingContext,
  ConnectionBrokerPort,
  GraphExecutorPort,
  PreflightCreditCheckFn,
} from "@/ports";
import { serverEnv } from "@/shared/env";
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
 */
export function createScopedGraphExecutor(params: {
  readonly executor: GraphExecutorPort;
  readonly billing: BillingContext;
  readonly preflightCheckFn: PreflightCreditCheckFn;
  readonly abortSignal?: AbortSignal;
  readonly broker?: ConnectionBrokerPort;
}): GraphExecutorPort {
  const container = getContainer();

  const enriched = new BillingEnrichmentGraphExecutorDecorator(
    params.executor,
    params.billing
  );

  // Validate enriched usage_report events before they reach the runtime relay.
  const billed = new BillingGraphExecutorDecorator(enriched, container.log);

  // Wrap with preflight credit check (rejects runs with insufficient credits)
  const preflighted = new PreflightCreditCheckDecorator(
    billed,
    params.preflightCheckFn,
    params.billing.billingAccountId,
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
      // No BYO connection — standard path
      if (!req.modelConnectionId || !params.broker) {
        return runGraphWithScope({
          executor: observed,
          req,
          ...(ctx ? { ctx } : {}),
          billing: params.billing,
          ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
        });
      }

      // BYO path: resolve credentials async, then run graph with LlmService override.
      // Graph runs normally (system prompt, tools, state) — only the LLM call swaps.
      const broker = params.broker;
      const connectionId = req.modelConnectionId;
      let innerResult: GraphRunResult | undefined;
      let resolveOuterFinal: ((v: GraphFinal) => void) | undefined;
      const outerFinal = new Promise<GraphFinal>((r) => {
        resolveOuterFinal = r;
      });

      // INVARIANT: outerFinal resolves only after stream is fully consumed.
      // Consumers must drain stream before awaiting final.
      const stream = (async function* () {
        let connection: import("@/ports").ResolvedConnection;
        try {
          connection = await broker.resolve(
            connectionId,
            params.billing.billingAccountId
          );
        } catch (err) {
          container.log.error(
            {
              connectionId,
              error: err instanceof Error ? err.message : String(err),
            },
            "BYO connection resolution failed"
          );
          yield {
            type: "error" as const,
            error: "internal" as import("@cogni/ai-core").AiExecutionErrorCode,
          };
          yield { type: "done" as const };
          // biome-ignore lint/style/noNonNullAssertion: assigned synchronously in Promise constructor
          resolveOuterFinal!({
            ok: false,
            runId: req.runId,
            requestId: ctx?.requestId ?? req.runId,
            error: "internal" as import("@cogni/ai-core").AiExecutionErrorCode,
          });
          return;
        }

        container.log.info(
          { connectionId, provider: connection.provider },
          "BYO connection resolved, swapping LlmService for this run"
        );

        const { CodexLlmAdapter } = await import(
          "@/adapters/server/ai/codex/codex-llm.adapter"
        );
        const llmServiceOverride = new CodexLlmAdapter(connection);

        innerResult = runGraphWithScope({
          executor: observed,
          req,
          ...(ctx ? { ctx } : {}),
          billing: params.billing,
          ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
          llmServiceOverride,
        });

        yield* innerResult.stream;
        const f = await innerResult.final;
        // biome-ignore lint/style/noNonNullAssertion: assigned synchronously in Promise constructor
        resolveOuterFinal!(f);
      })();

      return { stream, final: outerFinal };
    },
  };
}

/**
 * Run a graph within an execution scope.
 *
 * This is the ONLY app-local launch entrypoint. Every launcher (chat, schedule,
 * webhook, review) calls this — never executor.runGraph() directly.
 *
 * Sets AsyncLocalStorage scope so static inner providers can read billing context.
 * abortSignal is chat-only temporary tech debt — scheduled runs omit it.
 */
export function runGraphWithScope(params: {
  readonly executor: GraphExecutorPort;
  readonly req: GraphRunRequest;
  readonly ctx?: ExecutionContext;
  readonly billing: BillingContext;
  readonly abortSignal?: AbortSignal;
  readonly llmServiceOverride?: import("@/ports").LlmService;
}): GraphRunResult {
  const { executor, req, ctx, billing } = params;
  return runInScope(
    {
      billing,
      ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
      ...(params.llmServiceOverride
        ? { llmServiceOverride: params.llmServiceOverride }
        : {}),
    },
    () => executor.runGraph(req, ctx)
  );
}

/**
 * Create InProc provider for in-process graph execution.
 * Per CAPABILITY_INJECTION: toolSource contains real implementations with I/O.
 */
function createInProcProvider(
  deps: AiAdapterDeps,
  completionStreamFn: CompletionStreamFn
): LangGraphInProcProvider {
  const container = getContainer();
  const inprocAdapter = new InProcCompletionUnitAdapter(
    deps,
    completionStreamFn
  );
  return new LangGraphInProcProvider(inprocAdapter, container.toolSource);
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
