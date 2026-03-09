// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/graph-executor.factory`
 * Purpose: Factory for creating GraphExecutorPort implementations with observability and billing.
 * Scope: Bridges app layer (facades) to adapters layer via bootstrap. Does not contain business logic.
 * Invariants:
 *   - Facade NEVER imports adapters directly (use this factory)
 *   - Per UNIFIED_GRAPH_EXECUTOR: all graph execution flows through GraphExecutorPort
 *   - Per PROVIDER_AGGREGATION: AggregatingGraphExecutor routes to providers
 *   - Per LANGFUSE_INTEGRATION: ObservabilityGraphExecutorDecorator wraps for Langfuse traces
 *   - Per CALLBACK_IS_SOLE_WRITER: BillingGraphExecutorDecorator validates usage_report events (receipt writes via LiteLLM callback)
 *   - Per CREDITS_ENFORCED_AT_EXECUTION_PORT: PreflightCreditCheckDecorator rejects runs with insufficient credits
 *   - LAZY_SANDBOX_IMPORT: Sandbox provider loaded via dynamic import() to defer dockerode native addon chain (SandboxRunnerAdapter)
 * Side-effects: global (module-scoped cached sandbox provider promise)
 * Links: container.ts, AggregatingGraphExecutor, GRAPH_EXECUTION.md, OBSERVABILITY.md
 * @public
 */

import type { UserId } from "@cogni/ids";
import { LANGGRAPH_CATALOG } from "@cogni/langgraph-graphs";
import {
  AggregatingGraphExecutor,
  BillingGraphExecutorDecorator,
  type CompletionStreamFn,
  createLangGraphDevClient,
  type GraphProvider,
  InProcCompletionUnitAdapter,
  LangGraphDevProvider,
  LangGraphInProcProvider,
  ObservabilityGraphExecutorDecorator,
  PreflightCreditCheckDecorator,
} from "@/adapters/server";
import type {
  AiExecutionErrorCode,
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
  PreflightCreditCheckFn,
} from "@/ports";
import { serverEnv } from "@/shared/env";
import {
  type AiAdapterDeps,
  getContainer,
  resolveAiAdapterDeps,
} from "./container";

/**
 * Factory for creating AggregatingGraphExecutor with all configured providers.
 * Per UNIFIED_GRAPH_EXECUTOR: all graph execution flows through GraphExecutorPort.
 * Per PROVIDER_AGGREGATION: AggregatingGraphExecutor routes by graphId to providers.
 * Per CATALOG_SINGLE_SOURCE_OF_TRUTH: Provider imports catalog from @cogni/langgraph-graphs.
 * Per MUTUAL_EXCLUSION: Register exactly one langgraph provider (InProc XOR Dev) based on env.
 *
 * Architecture boundary: Facade calls this factory (app → bootstrap),
 * factory creates aggregator (bootstrap → adapters). Facade never imports adapters.
 *
 * Decorator stack (outer → inner):
 *   ObservabilityGraphExecutorDecorator → PreflightCreditCheckDecorator → BillingGraphExecutorDecorator → AggregatingGraphExecutor
 *
 * @param completionStreamFn - Feature function for LLM streaming (from features/ai)
 * @param userId - User ID for adapter dependency resolution
 * @param preflightCheckFn - Required preflight credit check function (created in app layer as closure)
 * @returns GraphExecutorPort implementation with observability + preflight + billing validation
 */
export function createGraphExecutor(
  completionStreamFn: CompletionStreamFn,
  userId: UserId,
  preflightCheckFn: PreflightCreditCheckFn
): GraphExecutorPort {
  const deps = resolveAiAdapterDeps(userId);
  const container = getContainer();

  // Per MUTUAL_EXCLUSION: choose provider based on LANGGRAPH_DEV_URL env
  const devUrl = serverEnv().LANGGRAPH_DEV_URL;
  const langGraphProvider = devUrl
    ? createDevProvider(devUrl)
    : createInProcProvider(deps, completionStreamFn);

  // Build providers array: langgraph + sandbox
  const env = serverEnv();
  const providers: GraphProvider[] = [
    langGraphProvider,
    new LazySandboxGraphProvider(
      env.LITELLM_MASTER_KEY,
      env.OPENCLAW_GATEWAY_URL,
      env.OPENCLAW_GATEWAY_TOKEN
    ),
  ];

  // Create aggregating executor with all configured providers
  const aggregator = new AggregatingGraphExecutor(providers);

  // Wrap with billing validation decorator (intercepts + validates usage_report events)
  // Per CALLBACK_IS_SOLE_WRITER: decorator validates only; LiteLLM callback writes receipts
  const billed = new BillingGraphExecutorDecorator(aggregator, container.log);

  // Wrap with preflight credit check (rejects runs with insufficient credits)
  // Per CREDITS_ENFORCED_AT_EXECUTION_PORT: all execution paths get credit check automatically
  const preflighted = new PreflightCreditCheckDecorator(
    billed,
    preflightCheckFn,
    container.log
  );

  // Wrap with observability decorator for Langfuse traces (outermost)
  // Per OBSERVABILITY.md#langfuse-integration: creates trace with I/O, handles terminal states
  // Note: Observability doesn't need usage_report events — billing consumes them before this layer
  const decorated = new ObservabilityGraphExecutorDecorator(
    preflighted,
    container.langfuse,
    { finalizationTimeoutMs: 15_000 },
    container.log
  );

  return decorated;
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
let _sandboxProvider: Promise<GraphProvider> | null = null;

function loadSandboxProvider(
  litellmMasterKey: string,
  gatewayUrl: string,
  gatewayToken: string
): Promise<GraphProvider> {
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

        return new SandboxGraphProvider(runner, gatewayClient) as GraphProvider;
      }
    );
  }
  return _sandboxProvider;
}

/**
 * GraphProvider that lazy-loads SandboxGraphProvider on first use.
 *
 * Avoids top-level import of dockerode → ssh2 → cpu-features (native addon)
 * which breaks Turbopack bundling when the barrel re-exports it.
 *
 * canHandle() is sync (prefix check only).
 * runGraph() returns {stream, final} synchronously; the async generator
 * inside awaits the cached import before delegating.
 */
class LazySandboxGraphProvider implements GraphProvider {
  readonly providerId = "sandbox";
  private readonly delegate: Promise<GraphProvider>;

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

  canHandle(graphId: string): boolean {
    return graphId.startsWith(`${this.providerId}:`);
  }

  runGraph(req: GraphRunRequest): GraphRunResult {
    const delegate = this.delegate;

    // Shared promise: resolves to delegate's runGraph result once module loads
    const innerResult = delegate.then((p) => p.runGraph(req));

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
          requestId: req.ingressRequestId,
          error: "internal",
        }) as const
    );

    return { stream, final };
  }
}
