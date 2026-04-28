// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/container`
 * Purpose: Dependency injection container for application composition root with environment-based adapter selection.
 * Scope: Wire adapters to ports for runtime dependency injection. Provides webhookRegistrations for ingestion route, Temporal WorkflowClient singleton. Does not handle request-scoped lifecycle.
 * Invariants: All ports wired; single container instance per process; config.unhandledErrorPolicy set by env; webhookRegistrations lazy-initialized; Temporal connection singleton with race-safe init.
 * Side-effects: IO (initializes logger and emits startup log on first access)
 * Notes: LLM always uses LiteLlmAdapter; stack tests route to mock-openai-api. ContainerConfig controls wrapper behavior.
 * Links: Used by API routes and other entry points; configure adapters here for DI.
 * @public
 */

import type { ToolSourcePort } from "@cogni/ai-core";
import type {
  KnowledgeCapability,
  MetricsCapability,
  RepoCapability,
  WebSearchCapability,
} from "@cogni/ai-tools";
import { CORE_TOOL_BUNDLE } from "@cogni/ai-tools";
import type { AttributionStore } from "@cogni/attribution-ledger";
import { DrizzleAttributionAdapter } from "@cogni/db-client";
import type { FinancialLedgerPort } from "@cogni/financial-ledger";
import { createTigerBeetleAdapter } from "@cogni/financial-ledger/adapters";
import type { UserId } from "@cogni/ids";
import { toUserId, userActor } from "@cogni/ids";
import { createKnowledgeCapability } from "@cogni/knowledge-store";
import {
  buildDoltgresClient,
  DoltgresKnowledgeStoreAdapter,
} from "@cogni/knowledge-store/adapters/doltgres";
import { parseMcpConfigFromEnv } from "@cogni/langgraph-graphs";
import { noopMetrics as noopMetricsForExecutor } from "@cogni/market-provider";
import { PolymarketDataApiClient } from "@cogni/market-provider/adapters/polymarket";
import {
  COGNI_SYSTEM_PRINCIPAL_USER_ID,
  EVENT_NAMES,
  initAnalytics,
  shutdownAnalytics,
} from "@cogni/node-shared";
import {
  type NodeStreamPort,
  RedisNodeStreamAdapter,
} from "@cogni/node-streams";
import { numberToPpm } from "@cogni/operator-wallet";
import { PrivyOperatorWalletAdapter } from "@cogni/operator-wallet/adapters/privy";
import { POLY_TOOL_BUNDLE } from "@cogni/poly-ai-tools";
import type { ScheduleControlPort } from "@cogni/scheduler-core";
import type { WorkItemQueryPort } from "@cogni/work-items";
import { MarkdownWorkItemAdapter } from "@cogni/work-items/markdown";
import {
  Client as TemporalClient,
  Connection as TemporalConnection,
  type WorkflowClient,
} from "@temporalio/client";
import Redis from "ioredis";
import type { Logger } from "pino";
import {
  ALCHEMY_ADAPTER_VERSION,
  AlchemyWebhookNormalizer,
  type Database,
  DrizzleAiTelemetryAdapter,
  DrizzleConnectionBrokerAdapter,
  DrizzleExecutionGrantUserAdapter,
  DrizzleExecutionGrantWorkerAdapter,
  DrizzleExecutionRequestAdapter,
  DrizzleGovernanceStatusAdapter,
  DrizzleGraphRunAdapter,
  DrizzleScheduleUserAdapter,
  DrizzleThreadPersistenceAdapter,
  EvmRpcOnChainVerifierAdapter,
  GITHUB_ADAPTER_VERSION,
  GitHubWebhookNormalizer,
  getAppDb,
  LangfuseAdapter,
  LiteLlmAdapter,
  type MimirAdapterConfig,
  MimirMetricsAdapter,
  RedisRunStreamAdapter,
  SystemClock,
  TemporalScheduleControlAdapter,
  UserDrizzleAccountService,
  UserDrizzlePaymentAttemptRepository,
  ViemEvmOnchainClient,
  ViemTreasuryAdapter,
} from "@/adapters/server";
import { ServiceDrizzleAccountService } from "@/adapters/server/accounts/drizzle.adapter";
import {
  AggregatingModelCatalog,
  ProviderResolver,
} from "@/adapters/server/ai/catalog";
import { mcpServersToCodexConfig } from "@/adapters/server/ai/codex/codex-mcp-config";
import {
  CodexModelProvider,
  OpenAiCompatibleModelProvider,
  PlatformModelProvider,
} from "@/adapters/server/ai/providers";
import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { ServiceDrizzlePaymentAttemptRepository } from "@/adapters/server/payments/drizzle-payment-attempt.adapter";
import { OpenRouterFundingAdapter } from "@/adapters/server/treasury/openrouter-funding.adapter";
import { SplitTreasurySettlementAdapter } from "@/adapters/server/treasury/split-treasury-settlement.adapter";
import {
  FakeMetricsAdapter,
  getTestEvmOnchainClient,
  getTestOnChainVerifier,
  getTestOperatorWallet,
} from "@/adapters/test";
import { createToolBindings } from "@/bootstrap/ai/tool-bindings";
import { createBoundToolSource } from "@/bootstrap/ai/tool-source.factory";
import { createMarketCapability } from "@/bootstrap/capabilities/market";
import {
  createMetricsCapability,
  derivePrometheusQueryUrl,
} from "@/bootstrap/capabilities/metrics";
import { createPolyResearchCapability } from "@/bootstrap/capabilities/poly-research";
import {
  createPolyTradeExecutorFactory,
  type PolyTradeExecutor,
} from "@/bootstrap/capabilities/poly-trade-executor";
import { createRepoCapability } from "@/bootstrap/capabilities/repo";
import { createScheduleCapability } from "@/bootstrap/capabilities/schedule";
import { stubVcsCapability } from "@/bootstrap/capabilities/vcs";
import { createWalletCapability } from "@/bootstrap/capabilities/wallet";
import { createWebSearchCapability } from "@/bootstrap/capabilities/web-search";
import { createWorkItemCapability } from "@/bootstrap/capabilities/work-item";
import type { RateLimitBypassConfig } from "@/bootstrap/http/wrapPublicRoute";
import { startMirrorPoll } from "@/bootstrap/jobs/copy-trade-mirror.job";
import {
  type OrderReconcilerHandle,
  startOrderReconciler,
} from "@/bootstrap/jobs/order-reconciler.job";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import { startProcessHealthPublisher } from "@/bootstrap/publishers";
import {
  type CopyTradeTargetSource,
  dbTargetSource,
} from "@/features/copy-trade/target-source";
import { createOrderLedger, type OrderLedger } from "@/features/trading";
import type {
  AccountService,
  AiTelemetryPort,
  Clock,
  ConnectionBrokerPort,
  DataSourceRegistration,
  GovernanceStatusPort,
  LangfusePort,
  LlmService,
  MetricsQueryPort,
  ModelCatalogPort,
  ModelProviderResolverPort,
  OnChainVerifier,
  OperatorWalletPort,
  PaymentAttemptServiceRepository,
  PaymentAttemptUserRepository,
  ProviderFundingPort,
  RunStreamPort,
  ServiceAccountService,
  ThreadPersistencePort,
  TreasuryReadPort,
  TreasurySettlementPort,
} from "@/ports";
import type {
  ExecutionGrantUserPort,
  ExecutionGrantWorkerPort,
  ExecutionRequestPort,
  GraphRunRepository,
  ScheduleUserPort,
} from "@/ports/server";
import {
  getDaoTreasuryAddress,
  getNodeId,
  getOperatorWalletConfig,
  getPaymentConfig,
  getScopeId,
} from "@/shared/config";
import { serverEnv } from "@/shared/env/server-env";
import { makeLogger } from "@/shared/observability";
import { USDC_TOKEN_ADDRESS } from "@/shared/web3";
import type { EvmOnchainClient } from "@/shared/web3/onchain/evm-onchain-client.interface";

export type UnhandledErrorPolicy = "rethrow" | "respond_500";

export interface ContainerConfig {
  /** How to handle unhandled errors in route wrappers: rethrow for dev/test, respond_500 for production safety */
  unhandledErrorPolicy: UnhandledErrorPolicy;
  /** Rate limit bypass config for stack tests; only enabled when APP_ENV=test */
  rateLimitBypass: RateLimitBypassConfig;
  /** Deploy environment for metrics/logging (e.g., "local", "preview", "production") */
  DEPLOY_ENVIRONMENT: string;
}

export interface Container {
  log: Logger;
  config: ContainerConfig;
  llmService: LlmService;
  accountsForUser(userId: UserId): AccountService;
  serviceAccountService: ServiceAccountService;
  clock: Clock;
  paymentAttemptsForUser(userId: UserId): PaymentAttemptUserRepository;
  paymentAttemptServiceRepository: PaymentAttemptServiceRepository;
  onChainVerifier: OnChainVerifier;
  evmOnchainClient: EvmOnchainClient;
  /** True when repo-spec has payments_in config (receiving address + chain). False for nodes pending activation. */
  paymentRailsActive: boolean;
  metricsQuery: MetricsQueryPort;
  treasuryReadPort: TreasuryReadPort;
  /** AI telemetry DB writer - always wired */
  aiTelemetry: AiTelemetryPort;
  /** Langfuse tracer - undefined when LANGFUSE_SECRET_KEY not set */
  langfuse: LangfusePort | undefined;
  nodeId: string;
  // Scheduling ports (split by trust boundary)
  scheduleControl: ScheduleControlPort;
  executionGrantPort: ExecutionGrantUserPort;
  executionGrantWorkerPort: ExecutionGrantWorkerPort;
  executionRequestPort: ExecutionRequestPort;
  graphRunRepository: GraphRunRepository;
  scheduleManager: ScheduleUserPort;
  /** Metrics capability for AI tools - requires PROMETHEUS_URL to be configured */
  metricsCapability: MetricsCapability;
  /** Web search capability for AI tools - requires TAVILY_API_KEY to be configured */
  webSearchCapability: WebSearchCapability;
  /** Repo capability for AI tools - requires COGNI_REPO_PATH */
  repoCapability: RepoCapability;
  /** Tool source with real implementations for AI tool execution */
  toolSource: ToolSourcePort;
  /** Thread persistence scoped to a user (RLS enforced) */
  threadPersistenceForUser(userId: UserId): ThreadPersistencePort;
  /** Governance status queries (system tenant scope) */
  governanceStatus: GovernanceStatusPort;
  /** Epoch ledger store — shared by app and scheduler-worker */
  attributionStore: AttributionStore;
  /** Work item queries — reads from markdown files via WorkItemQueryPort */
  workItemQuery: WorkItemQueryPort;
  /** Run event streaming — publish/subscribe via Redis Streams */
  runStream: RunStreamPort;
  /** Node-level event streaming — undefined when REDIS_URL not set */
  nodeStream: NodeStreamPort | undefined;
  /** Webhook source registrations — normalizers for webhook ingestion */
  webhookRegistrations: ReadonlyMap<string, DataSourceRegistration>;
  /** Financial ledger — undefined when TIGERBEETLE_ADDRESS not set */
  financialLedger: FinancialLedgerPort | undefined;
  /** Operator wallet — undefined when PRIVY_APP_ID not set */
  operatorWallet: OperatorWalletPort | undefined;
  /** Treasury settlement — undefined when operator wallet not configured */
  treasurySettlement: TreasurySettlementPort | undefined;
  /** Provider funding — undefined when OPENROUTER_API_KEY not set */
  providerFunding: ProviderFundingPort | undefined;
  /** Connection broker — undefined when CONNECTIONS_ENCRYPTION_KEY not set */
  connectionBroker: ConnectionBrokerPort | undefined;
  /** Model catalog — aggregates all providers for model listing */
  modelCatalog: ModelCatalogPort;
  /** Provider resolver — resolves providerKey to ModelProviderPort for runtime dispatch */
  providerResolver: ModelProviderResolverPort;
  /**
   * Copy-trade target source — strongly-typed seam for "which wallets is each
   * user monitoring right now?". Always DB-backed (`dbTargetSource`) against
   * `poly_copy_trade_targets` × `poly_copy_trade_config`; component + stack
   * tests get the testcontainers Postgres. Unit tests that want a
   * deterministic list construct `envTargetSource(wallets)` directly instead
   * of going through the container.
   * See `@/features/copy-trade/target-source.ts`.
   */
  copyTradeTargetSource: CopyTradeTargetSource;
  /**
   * Memoized `OrderLedger` singleton scoped to `serviceDb`. Routes must use
   * this instead of building per-request with `createOrderLedger(...)`.
   * The singleton is safe: `createOrderLedger` is stateless (no per-call
   * caches or request-bound state).
   */
  orderLedger: OrderLedger;
  /**
   * Service-role DB client (BYPASSRLS). Exposed for read APIs against
   * `poly_copy_trade_*` — the v0 copy-trade prototype's three tables are
   * system-owned (no RLS per migration 0027). This is a **deliberate v0
   * shortcut**, not a pattern to extend.
   *
   * **TODO(task.0315 P2 — MUST_FIX_P2):** add RLS to the three tables +
   * an `owner_user_id` column + mirror-coordinator writes via
   * `withTenantScope(db, operatorUserId, ...)` + routes migrate to
   * `getAppDb()` + session-scoped reads + this field gets REMOVED. See
   * `packages/db-client/src/tenant-scope.ts` for the existing pattern.
   * Any new route reaching for this field should instead gate on RLS.
   */
  serviceDb: Database;
  /**
   * Returns the wall time of the last completed reconciler tick, or null if
   * the reconciler has not ticked in this process (e.g. Polymarket creds
   * absent, or still awaiting first tick).
   *
   * SYNC_HEALTH_IS_PUBLIC invariant (task.0328 CP4).
   */
  reconcilerLastTickAt: () => Date | null;
  /**
   * Event-driven CTF redeem pipeline (task.0388). `null` when no active
   * `poly_wallet_connections` row was found at boot. Routes that enqueue
   * manual redeem jobs use `redeemPipeline.redeemJobs` + `funderAddress`.
   */
  redeemPipeline: {
    redeemJobs: import("@/ports").RedeemJobsPort;
    funderAddress: `0x${string}`;
  } | null;
}

// Feature-specific dependency types
// AI adapter deps: used internally by createGraphExecutor
export type AiAdapterDeps = {
  llmService: LlmService;
  accountService: AccountService;
  clock: Clock;
  aiTelemetry: AiTelemetryPort;
  langfuse: LangfusePort | undefined;
  nodeId: string;
};

/**
 * Activity dashboard dependencies.
 * Per CHARGE_RECEIPTS_IS_LEDGER_TRUTH: charge_receipts is primary data source.
 * LLM detail (model/tokens) fetched via listLlmChargeDetails, merged in facade.
 */
export type ActivityDeps = {
  accountService: AccountService;
};

// Module-level singleton
let _container: Container | null = null;
let _temporalConnection: TemporalConnection | null = null;
let _workflowClient: WorkflowClient | null = null;
let _workflowClientPromise: Promise<{
  client: WorkflowClient;
  taskQueue: string;
}> | null = null;
// Reconciler handle — set when the reconciler starts (async boot path).
// Null until Polymarket creds are present and the async initialiser fires.
let _reconcilerHandle: OrderReconcilerHandle | null = null;
// Target-set reconciler handle — separate from the ledger-order reconciler
// above. Starts/stops per-target mirror polls to match the active target set
// every 30s (bug.0338 / POLL_RECONCILES_PER_TICK).
let _targetsReconcilerStop: (() => void) | null = null;

/**
 * Get the singleton container instance.
 * Lazily initializes on first access.
 */
export function getContainer(): Container {
  if (!_container) {
    _container = createContainer();
  }
  return _container;
}

/**
 * Reset the singleton container.
 * For tests only - allows fresh container between test runs.
 */
export function resetContainer(): void {
  _container = null;
  _webhookRegistrations = null;
  _reconcilerHandle = null;
  if (_targetsReconcilerStop) {
    try {
      _targetsReconcilerStop();
    } catch {
      // Best-effort — tests re-create the container; nothing blocks here.
    }
    _targetsReconcilerStop = null;
  }
  if (_temporalConnection) {
    void _temporalConnection.close();
  }
  _temporalConnection = null;
  _workflowClient = null;
  _workflowClientPromise = null;
}

/**
 * Get a process-wide Temporal WorkflowClient singleton + task queue.
 * Avoids per-request Connection.connect() overhead on hot paths.
 * Returns both client and taskQueue so callers never need serverEnv() directly.
 */
export async function getTemporalWorkflowClient(): Promise<{
  client: WorkflowClient;
  taskQueue: string;
}> {
  // Per QUEUE_PER_NODE_ISOLATION (task.0280): submit to a per-node task queue
  // keyed on this node's UUID. The worker runs one Temporal Worker per node,
  // so one node's queue backlog does not starve the others.
  const perNodeTaskQueue = `${serverEnv().TEMPORAL_TASK_QUEUE}-${getNodeId()}`;
  if (_workflowClient) {
    return {
      client: _workflowClient,
      taskQueue: perNodeTaskQueue,
    };
  }
  if (!_workflowClientPromise) {
    _workflowClientPromise = (async () => {
      const env = serverEnv();
      const connection = await TemporalConnection.connect({
        address: env.TEMPORAL_ADDRESS,
      });
      const temporalClient = new TemporalClient({
        connection,
        namespace: env.TEMPORAL_NAMESPACE,
      });
      _temporalConnection = connection;
      _workflowClient = temporalClient.workflow;
      return { client: _workflowClient, taskQueue: perNodeTaskQueue };
    })();
  }
  return _workflowClientPromise;
}

/** Lazy singleton for webhook registrations (avoids import cost at container init). */
let _webhookRegistrations: ReadonlyMap<string, DataSourceRegistration> | null =
  null;

function getWebhookRegistrations(): ReadonlyMap<
  string,
  DataSourceRegistration
> {
  if (!_webhookRegistrations) {
    const registrations = new Map<string, DataSourceRegistration>();
    registrations.set("github", {
      source: "github",
      version: GITHUB_ADAPTER_VERSION,
      webhook: new GitHubWebhookNormalizer(),
    });
    registrations.set("alchemy", {
      source: "alchemy",
      version: ALCHEMY_ADAPTER_VERSION,
      webhook: new AlchemyWebhookNormalizer(),
    });
    _webhookRegistrations = registrations;
  }
  return _webhookRegistrations;
}

function createContainer(): Container {
  const env = serverEnv();
  const nodeId = getNodeId();
  const db = getAppDb();
  const log = makeLogger({ service: "cogni-template", nodeId });

  // Startup log - confirm config in Loki (no URLs/secrets)
  log.info(
    {
      env: env.APP_ENV,
      logLevel: env.PINO_LOG_LEVEL,
      pretty: env.NODE_ENV === "development",
    },
    "container initialized"
  );

  // Initialize PostHog product analytics (required — env validated at boot)
  initAnalytics({
    apiKey: env.POSTHOG_API_KEY,
    host: env.POSTHOG_HOST,
    appVersion: env.COGNI_REPO_SHA ?? "unknown",
    environment: env.DEPLOY_ENVIRONMENT ?? "local",
  });
  log.info("PostHog analytics initialized");

  // Flush analytics events on graceful shutdown
  const flushOnExit = () => {
    shutdownAnalytics().catch(() => {});
  };
  process.on("SIGTERM", flushOnExit);
  process.on("SIGINT", flushOnExit);

  // LLM adapter: always LiteLlmAdapter (test stacks use mock-openai-api via litellm.test.config.yaml)
  const llmService = new LiteLlmAdapter();

  // EvmOnchainClient: test uses singleton fake (configurable from tests), production uses viem RPC
  const evmOnchainClient = env.isTestMode
    ? getTestEvmOnchainClient()
    : new ViemEvmOnchainClient();

  // OnChainVerifier: test uses singleton fake (configurable from tests), production uses EVM RPC verifier
  const onChainVerifier = env.isTestMode
    ? getTestOnChainVerifier()
    : new EvmRpcOnChainVerifierAdapter(evmOnchainClient);

  // MetricsQuery: test uses fake adapter, production uses Prometheus HTTP API
  // Not configured: stub that throws on use (deferred error, doesn't block startup)
  const metricsQuery: MetricsQueryPort = env.isTestMode
    ? new FakeMetricsAdapter()
    : (() => {
        const queryUrl = derivePrometheusQueryUrl(env);
        if (
          !queryUrl ||
          !env.PROMETHEUS_READ_USERNAME ||
          !env.PROMETHEUS_READ_PASSWORD
        ) {
          // Return stub that throws on use - allows app to start without metrics config
          const notConfiguredError = new Error(
            "MetricsQueryPort not configured. Set PROMETHEUS_QUERY_URL (or PROMETHEUS_REMOTE_WRITE_URL " +
              "ending in /api/prom/push) + PROMETHEUS_READ_USERNAME + PROMETHEUS_READ_PASSWORD."
          );
          return {
            queryRange: async () => {
              throw notConfiguredError;
            },
            queryInstant: async () => {
              throw notConfiguredError;
            },
            queryTemplate: async () => {
              throw notConfiguredError;
            },
          } satisfies MetricsQueryPort;
        }

        const mimirConfig: MimirAdapterConfig = {
          url: queryUrl,
          username: env.PROMETHEUS_READ_USERNAME,
          password: env.PROMETHEUS_READ_PASSWORD,
          timeoutMs: env.ANALYTICS_QUERY_TIMEOUT_MS,
        };
        return new MimirMetricsAdapter(mimirConfig);
      })();

  // FinancialLedger: optional — only when TIGERBEETLE_ADDRESS is configured
  // @cogni/financial-ledger/adapters is in serverExternalPackages (N-API addon, not bundleable)
  const financialLedger: FinancialLedgerPort | undefined = (() => {
    if (!env.TIGERBEETLE_ADDRESS) return undefined;
    try {
      const adapter = createTigerBeetleAdapter(env.TIGERBEETLE_ADDRESS);
      log.info(
        { address: env.TIGERBEETLE_ADDRESS },
        "TigerBeetle financial ledger connected"
      );
      return adapter;
    } catch (err) {
      log.warn(
        { err },
        "TigerBeetle client failed to initialize — financial ledger disabled"
      );
      return undefined;
    }
  })();

  // Always use real database adapters
  // Testing strategy: unit tests mock the port, integration tests use real DB
  const serviceAccountService = new ServiceDrizzleAccountService(
    getServiceDb(),
    financialLedger
  );
  // TreasuryReadPort: always uses ViemTreasuryAdapter (no test fake needed - mocked at port level in tests)
  const treasuryReadPort = new ViemTreasuryAdapter(evmOnchainClient);

  // AI Telemetry: DrizzleAiTelemetryAdapter always wired (per AI_SETUP_SPEC.md)
  const aiTelemetry = new DrizzleAiTelemetryAdapter(db);

  // Langfuse: only wired when LANGFUSE_SECRET_KEY is set (optional)
  // Environment read by SDK from LANGFUSE_TRACING_ENVIRONMENT env var
  const langfuse: Container["langfuse"] =
    env.LANGFUSE_SECRET_KEY && env.LANGFUSE_PUBLIC_KEY
      ? new LangfuseAdapter({
          publicKey: env.LANGFUSE_PUBLIC_KEY,
          secretKey: env.LANGFUSE_SECRET_KEY,
          ...(env.LANGFUSE_BASE_URL ? { baseUrl: env.LANGFUSE_BASE_URL } : {}),
        })
      : undefined;

  const clock = new SystemClock();

  // Scheduling adapters (from @cogni/db-client)
  // Per architecture rule: composition root injects loggers via child()

  // ScheduleControlPort: Temporal is required infrastructure
  // Per SCHEDULER_SPEC.md: TEMPORAL_ADDRESS + TEMPORAL_NAMESPACE must be configured
  if (!env.TEMPORAL_ADDRESS || !env.TEMPORAL_NAMESPACE) {
    throw new Error(
      "TEMPORAL_ADDRESS and TEMPORAL_NAMESPACE are required. " +
        "Start Temporal with: pnpm dev:infra"
    );
  }
  // Per QUEUE_PER_NODE_ISOLATION: Schedules submit to this node's per-node
  // queue. Existing schedules on the legacy queue keep firing until their
  // next update (drain Worker in scheduler-worker still polls the base name).
  const scheduleControl: ScheduleControlPort =
    new TemporalScheduleControlAdapter({
      address: env.TEMPORAL_ADDRESS,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: `${env.TEMPORAL_TASK_QUEUE}-${getNodeId()}`,
    });

  // Service DB (BYPASSRLS) for worker adapters
  const serviceDb = getServiceDb();

  // Memoized OrderLedger singleton — routes use container.orderLedger instead
  // of building per-request. createOrderLedger is stateless so this is safe.
  const orderLedger = createOrderLedger({
    db: serviceDb as unknown as import("drizzle-orm/node-postgres").NodePgDatabase,
    logger: log,
  });

  const paymentAttemptServiceRepository =
    new ServiceDrizzlePaymentAttemptRepository(serviceDb);

  // User-facing scheduling (appDb, RLS enforced)
  const executionGrantPort = new DrizzleExecutionGrantUserAdapter(
    db,
    log.child({ component: "DrizzleExecutionGrantUserAdapter" })
  );
  const scheduleManager = new DrizzleScheduleUserAdapter(
    db,
    scheduleControl,
    executionGrantPort,
    log.child({ component: "DrizzleScheduleUserAdapter" })
  );

  // Worker scheduling (serviceDb, BYPASSRLS)
  const executionGrantWorkerPort = new DrizzleExecutionGrantWorkerAdapter(
    serviceDb,
    log.child({ component: "DrizzleExecutionGrantWorkerAdapter" })
  );
  const graphRunRepository = new DrizzleGraphRunAdapter(
    serviceDb,
    log.child({ component: "DrizzleGraphRunAdapter" })
  );

  // Execution request port (not user-scoped — exempt from RLS)
  const executionRequestPort = new DrizzleExecutionRequestAdapter(
    db,
    log.child({ component: "DrizzleExecutionRequestAdapter" })
  );

  // MetricsCapability for AI tools (requires PROMETHEUS_URL)
  const metricsCapability = createMetricsCapability(env);

  // WebSearchCapability for AI tools (requires TAVILY_API_KEY)
  const webSearchCapability = createWebSearchCapability(env);

  // RepoCapability for AI tools (requires COGNI_REPO_PATH)
  const repoCapability = createRepoCapability(env);

  // WorkItemCapability for AI tools (delegates to markdown adapter ports)
  const workItemAdapter = new MarkdownWorkItemAdapter(
    env.COGNI_REPO_ROOT ?? "/nonexistent"
  );
  const workItemCapability = createWorkItemCapability({
    workItemQuery: workItemAdapter,
    workItemCommand: workItemAdapter,
  });

  // ScheduleCapability for AI tools (reads actorUserId from ALS at invocation time)
  const scheduleCapability = createScheduleCapability({
    scheduleManager,
    getOrCreateBillingAccountId: async (userId) => {
      const accountService = new UserDrizzleAccountService(
        db,
        userId,
        financialLedger
      );
      const account = await accountService.getOrCreateBillingAccountForUser({
        userId: userId as string,
      });
      return account.id;
    },
  });

  // MarketCapability for AI tools (live Polymarket + optional Kalshi)
  // Dynamic import avoided — direct import at top of file
  const marketCapability = createMarketCapability({
    KALSHI_API_KEY: env.KALSHI_API_KEY,
    KALSHI_API_SECRET: env.KALSHI_API_SECRET,
  });

  // WalletCapability for AI tools (Polymarket wallet scoreboard — public Data API)
  const walletCapability = createWalletCapability();

  // PolyDataCapability for the 7 `core__poly_data_*` research tools (task.0386).
  // Public Data API (no auth). Client is dedicated to this capability; the
  // mirror poll below still constructs its own client lazily inside the lazy
  // import block so pods without Polymarket creds avoid loading that code path.
  const polyDataCapability = createPolyResearchCapability({
    dataApiClient: new PolymarketDataApiClient(),
  });

  // Copy-trade target source — always DB-backed. Component + stack tests
  // have a real Postgres (testcontainers), so there's no need to fall back to
  // an in-memory env impl. Pure unit tests that want a deterministic list
  // construct `envTargetSource(wallets)` directly.
  const copyTradeTargetSource: CopyTradeTargetSource = dbTargetSource({
    appDb:
      db as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase<
        Record<string, unknown>
      >,
    serviceDb:
      serviceDb as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase<
        Record<string, unknown>
      >,
  });

  // Per-tenant trade-executor factory. Lazily constructs a
  // `PolyTradeExecutor` for a given `billingAccountId`. Uses the per-user
  // Privy app (`PRIVY_USER_WALLETS_*`) — distinct from the operator-wallet
  // Privy app used by `OperatorWalletPort`. Undefined when any of those
  // envs are missing; callers degrade gracefully (no mirror polls, no
  // order reconciler). Sole placement path post Stage 4 purge — the former
  // single-operator `polyTradeBundle` is gone and will not come back.
  const polyTradeExecutorFactory:
    | ReturnType<typeof createPolyTradeExecutorFactory>
    | undefined = (() => {
    try {
      const walletPort = getPolyTraderWalletAdapter(log);
      return createPolyTradeExecutorFactory({
        walletPort,
        logger: log,
        metrics: noopMetricsForExecutor,
        host: env.POLY_CLOB_HOST,
        polygonRpcUrl: env.POLYGON_RPC_URL,
      });
    } catch (err) {
      if (err instanceof WalletAdapterUnconfiguredError) {
        log.info(
          { missing: err.message },
          "per-tenant poly-trade executor not configured (PRIVY_USER_WALLETS_* or POLY_WALLET_AEAD_* missing)"
        );
        return undefined;
      }
      throw err;
    }
  })();

  // Autonomous 30s mirror poll per target wallet. A target-set reconciler
  // ticks `copyTradeTargetSource.listAllActive()` every 30s and diffs the
  // result against running per-target polls — so a user POSTing a tracked
  // wallet begins copy-trading within one tick, with no pod restart
  // (bug.0338 / POLL_RECONCILES_PER_TICK). One `startMirrorPoll` per active
  // (tenant × wallet); exactly one `startOrderReconciler` process-wide
  // (per-tenant dispatch is internal, routed through the executor factory).
  //
  // Post-cutover gate: the poll + reconciler start iff
  // `polyTradeExecutorFactory` exists, i.e. `PRIVY_USER_WALLETS_*` and
  // `POLY_WALLET_AEAD_*` are configured. Daily/hourly USDC caps live in
  // each tenant's `poly_wallet_grants` and are enforced by `authorizeIntent`
  // on the hot path inside `PolyTradeExecutor.placeIntent`.
  // `poly_copy_trade_config.enabled` remains the per-tenant kill-switch.
  if (polyTradeExecutorFactory !== undefined) {
    const executorFactory = polyTradeExecutorFactory;
    // Lazy-load the poll wiring so its transitive imports (Data-API HTTP
    // client, Drizzle queries) don't run on pods without Polymarket creds.
    void (async () => {
      try {
        const { createPolymarketActivitySource } = await import(
          "@/features/wallet-watch"
        );
        const { PolymarketDataApiClient } = await import(
          "@cogni/market-provider/adapters/polymarket"
        );
        // noopMetrics for v0 — real prom-client wiring folds into a follow-up
        // once the `poly_mirror_*` series has a Grafana dashboard to back it.
        const { noopMetrics } = await import("@cogni/market-provider");
        const { buildMirrorTargetConfig } = await import(
          "@/bootstrap/jobs/copy-trade-mirror.job"
        );
        const { startCopyTradeReconciler } = await import(
          "@/bootstrap/copy-trade-reconciler"
        );
        const dataApiClient = new PolymarketDataApiClient();
        // pino's Logger is structurally compatible with LoggerPort's subset
        // (debug/info/warn/error/child with object + optional msg).
        const mirrorLogger =
          log as unknown as import("@cogni/market-provider").LoggerPort;

        // Ledger reconciler — syncs open/pending rows from CLOB getOrder,
        // dispatched per tenant. Each ledger row carries its
        // `billing_account_id`; the reconciler routes `getOrder` through the
        // per-tenant `PolyTradeExecutor` so we hit the right CLOB API creds
        // (each tenant's creds are derived from their Privy signer). One
        // reconciler runs on the pod; per-tenant dispatch is internal.
        _reconcilerHandle = startOrderReconciler({
          ledger: orderLedger,
          getOrderForTenant: async (billingAccountId, orderId) => {
            const executor =
              await executorFactory.getPolyTradeExecutorFor(billingAccountId);
            return executor.getOrder(orderId);
          },
          logger: mirrorLogger,
          metrics: noopMetrics,
          notFoundGraceMs: env.POLY_CLOB_NOT_FOUND_GRACE_MS,
        });

        // Target-set reconciler — ticks listAllActive every 30s, starts/stops
        // per-wallet polls to match. First tick fires immediately. See
        // docs/spec/poly-multi-tenant-auth.md § POLL_RECONCILES_PER_TICK.
        //
        // `listAllActive` joins `poly_wallet_connections` +
        // `poly_wallet_grants`, so the reconciler only hands us tenants that
        // have (a) an active trading wallet and (b) an active grant. Each
        // per-tenant poll routes placements through the per-tenant
        // `PolyTradeExecutor`, which wraps every `placeOrder` with
        // `authorizeIntent` so scope + cap + grant-revoke checks run on the
        // hot path.
        _targetsReconcilerStop = startCopyTradeReconciler({
          targetSource: copyTradeTargetSource,
          startPollForTarget: (enumeratedTarget) => {
            const targetWallet = enumeratedTarget.targetWallet;
            const target = buildMirrorTargetConfig({
              targetWallet,
              billingAccountId: enumeratedTarget.billingAccountId,
              createdByUserId: enumeratedTarget.createdByUserId,
            });
            const source = createPolymarketActivitySource({
              client: dataApiClient,
              wallet: targetWallet,
              logger: mirrorLogger,
              metrics: noopMetrics,
            });

            // Build once per (tenant × target). Executor is cached across
            // ticks inside the factory keyed on billingAccountId.
            let cachedExecutor: PolyTradeExecutor | null = null;
            const getExecutor = async (): Promise<PolyTradeExecutor> => {
              if (cachedExecutor) return cachedExecutor;
              cachedExecutor = await executorFactory.getPolyTradeExecutorFor(
                enumeratedTarget.billingAccountId
              );
              return cachedExecutor;
            };

            return startMirrorPoll({
              target,
              source,
              ledger: orderLedger,
              placeIntent: async (intent) => {
                const executor = await getExecutor();
                return executor.placeIntent(intent);
              },
              getMarketConstraints: async (tokenId) => {
                const executor = await getExecutor();
                return executor.getMarketConstraints(tokenId);
              },
              closePosition: async (params) => {
                const executor = await getExecutor();
                return executor.closePosition(params);
              },
              getOperatorPositions: async () => {
                const executor = await getExecutor();
                const positions = await executor.listPositions();
                return positions.map((p) => ({
                  asset: p.asset,
                  size: p.size,
                }));
              },
              logger: mirrorLogger,
              metrics: noopMetrics,
            });
          },
          logger: mirrorLogger,
        });
      } catch (err: unknown) {
        log.error(
          {
            event: EVENT_NAMES.POLY_MIRROR_POLL_BOOT_FAILED,
            errorCode: "boot_init_failed",
            err: err instanceof Error ? err.message : String(err),
          },
          "mirror poll boot failed — continuing without autonomous mirror"
        );
      }
    })();
  } else {
    log.info(
      {
        event: EVENT_NAMES.POLY_MIRROR_POLL_SKIPPED,
        has_executor_factory: false,
      },
      "mirror poll + order reconciler not started (PRIVY_USER_WALLETS_* or POLY_WALLET_AEAD_* missing)"
    );
  }

  // task.0388 — event-driven redeem pipeline. Replaces the deleted
  // `runRedeemSweep` polling loop. Bound to the single active
  // `poly_wallet_connections` row at boot (v0.2 single-funder); skipped
  // when the trader-wallet adapter is unconfigured. Fire-and-forget like
  // the mirror loop above; `redeemPipelineHandles` is read via a getter
  // on the container so routes pick up the value once start completes.
  let redeemPipelineHandles:
    | import("./redeem-pipeline").RedeemPipelineHandles
    | null = null;
  if (env.POLYGON_RPC_URL) {
    const polygonRpcUrl = env.POLYGON_RPC_URL;
    void (async () => {
      try {
        const walletPort = getPolyTraderWalletAdapter(log);
        const { startRedeemPipeline } = await import("./redeem-pipeline");
        redeemPipelineHandles = await startRedeemPipeline({
          serviceDb,
          walletPort,
          polygonRpcUrl,
          log,
        });
      } catch (err) {
        if (err instanceof WalletAdapterUnconfiguredError) {
          log.info(
            { missing: err.message },
            "redeem pipeline not started (PRIVY_USER_WALLETS_* or POLY_WALLET_AEAD_* missing)"
          );
        } else {
          log.error(
            { err: err instanceof Error ? err.message : String(err) },
            "redeem pipeline boot failed — continuing without autonomous redeems"
          );
        }
      }
    })();
  }

  // KnowledgeCapability for AI tools (optional — requires DOLTGRES_URL_POLY)
  // When configured, wraps KnowledgeStorePort with auto-commit on writes.
  // When not configured, tools throw "not configured" at invocation time.
  let knowledgeCapability: KnowledgeCapability;
  if (env.DOLTGRES_URL_POLY) {
    const doltClient = buildDoltgresClient({
      connectionString: env.DOLTGRES_URL_POLY,
      applicationName: `cogni_knowledge_${env.SERVICE_NAME ?? "app"}`,
    });
    const knowledgePort = new DoltgresKnowledgeStoreAdapter({
      sql: doltClient,
    });
    knowledgeCapability = createKnowledgeCapability(knowledgePort);
    log.info("Knowledge store configured (Doltgres)");
  } else {
    const notConfigured = () => {
      throw new Error(
        "KnowledgeCapability not configured. Set DOLTGRES_URL_POLY."
      );
    };
    knowledgeCapability = {
      search: notConfigured,
      list: notConfigured,
      get: notConfigured,
      write: notConfigured,
    };
    log.warn("Knowledge store not configured (DOLTGRES_URL_POLY not set)");
  }

  // ToolSource with real implementations (per CAPABILITY_INJECTION).
  // The agent-facing trade tools (core__poly_{place_trade,list_orders,
  // cancel_order}) are intentionally NOT in POLY_TOOL_BUNDLE — their contracts
  // live in @cogni/poly-ai-tools for the future per-tenant re-wire (dispatch
  // through PolyTradeExecutor with actor identity at tool invocation time).
  // See bug.0319 ckpt 3.
  const toolBindings = createToolBindings({
    knowledgeCapability,
    marketCapability,
    metricsCapability,
    polyDataCapability,
    webSearchCapability,
    repoCapability,
    scheduleCapability,
    vcsCapability: stubVcsCapability,
    walletCapability,
    workItemCapability,
  });
  const toolSource = createBoundToolSource(
    [...CORE_TOOL_BUNDLE, ...POLY_TOOL_BUNDLE],
    toolBindings
  );

  // Config: rethrow in dev/test for diagnosis, respond_500 in production for safety
  const config: ContainerConfig = {
    unhandledErrorPolicy: env.isProd ? "respond_500" : "rethrow",
    // Rate limit bypass: only enabled in test mode (APP_ENV=test)
    // Security: Production builds will never enable bypass regardless of header
    rateLimitBypass: {
      enabled: env.isTestMode,
      headerName: "x-stack-test",
      headerValue: "1",
    },
    // Deploy environment for metrics/logging
    DEPLOY_ENVIRONMENT: env.DEPLOY_ENVIRONMENT ?? "local",
  };

  // OperatorWallet: test uses fake, production uses Privy (optional — only when configured)
  const operatorWalletConfig = getOperatorWalletConfig();
  const operatorWallet: OperatorWalletPort | undefined = env.isTestMode
    ? getTestOperatorWallet()
    : (() => {
        if (
          !env.PRIVY_APP_ID ||
          !env.PRIVY_APP_SECRET ||
          !env.PRIVY_SIGNING_KEY
        ) {
          return undefined;
        }
        if (!operatorWalletConfig) {
          log.warn(
            "PRIVY_APP_ID set but operator_wallet missing from repo-spec — skipping operator wallet"
          );
          return undefined;
        }
        const treasuryAddress = getDaoTreasuryAddress();
        if (!treasuryAddress) {
          log.warn(
            "operator_wallet configured but cogni_dao.dao_contract missing — skipping operator wallet"
          );
          return undefined;
        }
        const paymentConfig = getPaymentConfig();
        if (!paymentConfig) {
          log.warn(
            "PRIVY_APP_ID set but payments_in missing from repo-spec — run `pnpm node:activate-payments`"
          );
          return undefined;
        }
        if (!env.EVM_RPC_URL) {
          log.warn(
            "PRIVY_APP_ID set but EVM_RPC_URL missing — operator wallet requires RPC for tx confirmation"
          );
          return undefined;
        }
        return new PrivyOperatorWalletAdapter({
          appId: env.PRIVY_APP_ID,
          appSecret: env.PRIVY_APP_SECRET,
          signingKey: env.PRIVY_SIGNING_KEY,
          expectedAddress: operatorWalletConfig.address,
          splitAddress: paymentConfig.receivingAddress,
          treasuryAddress,
          markupPpm: numberToPpm(env.USER_PRICE_MARKUP_FACTOR),
          revenueSharePpm: numberToPpm(env.SYSTEM_TENANT_REVENUE_SHARE),
          maxTopUpUsd: env.OPERATOR_MAX_TOPUP_USD,
          rpcUrl: env.EVM_RPC_URL,
        });
      })();

  // ProviderFunding: optional — only when OPENROUTER_API_KEY is configured + operator wallet available
  // Per MARGIN_PRESERVED: fail fast if pricing constants don't preserve positive margin
  const providerFunding: ProviderFundingPort | undefined = (() => {
    if (!env.OPENROUTER_API_KEY || !operatorWallet) return undefined;

    // MARGIN_PRESERVED: markup × (1 - fee) must be > 1 + revenueShare
    const effectiveMarkup =
      env.USER_PRICE_MARKUP_FACTOR * (1 - env.OPENROUTER_CRYPTO_FEE);
    if (effectiveMarkup <= 1 + env.SYSTEM_TENANT_REVENUE_SHARE) {
      throw new Error(
        `MARGIN_PRESERVED violation: markup(${env.USER_PRICE_MARKUP_FACTOR}) × (1 - fee(${env.OPENROUTER_CRYPTO_FEE})) ` +
          `must be > 1 + revenueShare(${env.SYSTEM_TENANT_REVENUE_SHARE}). ` +
          "DAO would lose money on every purchase."
      );
    }

    return new OpenRouterFundingAdapter(
      getServiceDb(),
      operatorWallet,
      { apiKey: env.OPENROUTER_API_KEY },
      log.child({ component: "OpenRouterFundingAdapter" })
    );
  })();

  // Connection broker — BYO-AI credential resolution
  // Undefined when CONNECTIONS_ENCRYPTION_KEY not set
  const connectionBroker: ConnectionBrokerPort | undefined = (() => {
    if (!env.CONNECTIONS_ENCRYPTION_KEY) return undefined;
    const keyBuf = Buffer.from(env.CONNECTIONS_ENCRYPTION_KEY, "hex");
    if (keyBuf.length !== 32) {
      log.warn(
        "CONNECTIONS_ENCRYPTION_KEY must be 64 hex chars (32 bytes). BYO-AI disabled."
      );
      return undefined;
    }
    return new DrizzleConnectionBrokerAdapter({
      db: db as unknown as import("drizzle-orm/node-postgres").NodePgDatabase,
      encryptionKey: keyBuf,
      encryptionKeyId: "v1",
      log,
    });
  })();

  // Redis client for run event streaming (ephemeral stream plane)
  // Per REDIS_IS_STREAM_PLANE: only transient data, no durable state
  const redisClient = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
  const runStream = new RedisRunStreamAdapter(redisClient);
  const nodeStream = new RedisNodeStreamAdapter(redisClient);

  // Process health publisher (node-local metrics only — external sources use Temporal)
  const publisherAbort = new AbortController();
  process.on("SIGTERM", () => publisherAbort.abort());
  process.on("SIGINT", () => publisherAbort.abort());
  startProcessHealthPublisher({
    port: nodeStream,
    streamKey: `node:${nodeId}:events`,
    signal: publisherAbort.signal,
    logger: log,
    environment: env.DEPLOY_ENVIRONMENT ?? "local",
  });

  return {
    log,
    config,
    llmService,
    accountsForUser: (userId: UserId) =>
      new UserDrizzleAccountService(db, userId, financialLedger),
    serviceAccountService,
    clock,
    paymentAttemptsForUser: (userId: UserId) =>
      new UserDrizzlePaymentAttemptRepository(db, userId),
    paymentAttemptServiceRepository,
    onChainVerifier,
    evmOnchainClient,
    paymentRailsActive: !!getPaymentConfig(),
    metricsQuery,
    treasuryReadPort,
    aiTelemetry,
    langfuse,
    nodeId,
    scheduleControl,
    executionGrantPort,
    executionGrantWorkerPort,
    executionRequestPort,
    graphRunRepository,
    scheduleManager,
    metricsCapability,
    webSearchCapability,
    repoCapability,
    toolSource,
    threadPersistenceForUser: (userId: UserId) =>
      new DrizzleThreadPersistenceAdapter(db, userActor(userId)),
    governanceStatus: new DrizzleGovernanceStatusAdapter(
      db,
      userActor(toUserId(COGNI_SYSTEM_PRINCIPAL_USER_ID))
    ),
    attributionStore: new DrizzleAttributionAdapter(serviceDb, getScopeId()),
    workItemQuery: workItemAdapter,
    runStream,
    nodeStream,
    get webhookRegistrations() {
      return getWebhookRegistrations();
    },
    financialLedger,
    operatorWallet,
    treasurySettlement: operatorWallet
      ? new SplitTreasurySettlementAdapter(operatorWallet, USDC_TOKEN_ADDRESS)
      : undefined,
    providerFunding,
    connectionBroker,
    // Multi-provider model ports
    ...(() => {
      const platformProvider = new PlatformModelProvider(llmService);
      // Parse MCP server config for Codex native MCP support (bug.0232).
      // parseMcpConfigFromEnv is synchronous (reads file + env vars).
      const codexMcpConfig = mcpServersToCodexConfig(parseMcpConfigFromEnv());
      const codexProvider = new CodexModelProvider(codexMcpConfig);
      const openAiCompatibleProvider = new OpenAiCompatibleModelProvider(
        connectionBroker,
        resolveAppDb
      );
      const providers = [
        platformProvider,
        codexProvider,
        openAiCompatibleProvider,
      ];
      return {
        modelCatalog: new AggregatingModelCatalog(providers),
        providerResolver: new ProviderResolver(providers),
      };
    })(),
    copyTradeTargetSource,
    orderLedger,
    serviceDb,
    reconcilerLastTickAt() {
      return _reconcilerHandle?.getLastTickAt() ?? null;
    },
    get redeemPipeline() {
      return redeemPipelineHandles
        ? {
            redeemJobs: redeemPipelineHandles.redeemJobs,
            funderAddress: redeemPipelineHandles.funderAddress,
          }
        : null;
    },
  };
}

/**
 * Resolves dependencies for AI adapter construction.
 * Used by graph-executor.factory.ts.
 */
export function resolveAiAdapterDeps(userId: UserId): AiAdapterDeps {
  const container = getContainer();
  return {
    llmService: container.llmService,
    accountService: container.accountsForUser(userId),
    clock: container.clock,
    aiTelemetry: container.aiTelemetry,
    langfuse: container.langfuse,
    nodeId: container.nodeId,
  };
}

export function resolveActivityDeps(userId: UserId): ActivityDeps {
  const container = getContainer();
  return {
    accountService: container.accountsForUser(userId),
  };
}

/**
 * Scheduling dependencies for CRUD operations.
 * Used by schedule routes.
 */
export type SchedulingDeps = Pick<
  Container,
  | "scheduleControl"
  | "executionGrantPort"
  | "executionGrantWorkerPort"
  | "graphRunRepository"
  | "scheduleManager"
>;

export function resolveSchedulingDeps(): SchedulingDeps {
  const container = getContainer();
  return {
    scheduleControl: container.scheduleControl,
    executionGrantPort: container.executionGrantPort,
    executionGrantWorkerPort: container.executionGrantWorkerPort,
    graphRunRepository: container.graphRunRepository,
    scheduleManager: container.scheduleManager,
  };
}

/**
 * Resolve appDb for facade-level queries that don't need a full port abstraction.
 * Uses appDb (RLS-scoped) — caller must be authenticated.
 */
export function resolveAppDb(): Database {
  return getAppDb();
}

/**
 * Resolve serviceDb for pre-auth or system-level writes that must bypass RLS.
 */
export function resolveServiceDb(): Database {
  return getServiceDb();
}
