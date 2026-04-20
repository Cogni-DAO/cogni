import fs from "node:fs/promises";
import path from "node:path";
import prettier from "prettier";
import { z } from "zod";
import { AI_EXECUTION_ERROR_CODES } from "../../packages/ai-core/src/index.ts";
import {
  GrantValidationErrorCode,
  GraphRunKindSchema,
  GraphRunUpdateStatusSchema,
  InternalCreateGraphRunInputSchema,
  InternalCreateGraphRunOutputSchema,
  InternalGraphRunInputSchema,
  InternalGraphRunOutputSchema,
  InternalUpdateGraphRunOutputSchema,
  InternalValidateGrantInputSchema,
  InternalValidateGrantOutputSchema,
  metaLivezOutputSchema,
  metaReadyzOutputSchema,
} from "../../packages/node-contracts/src/index.ts";
import {
  type Account,
  applyBaselineSystemPrompt,
  assertMessageLength,
  BASELINE_SYSTEM_PROMPT,
  calculateLlmUserCharge,
  calculateOpenRouterTopUp,
  calculateRevenueShareBonus,
  creditsToUsd,
  ensureHasCredits,
  estimateTotalTokens,
  filterSystemMessages,
  hasSufficientCredits,
  isIntentExpired,
  isMarginPreserved,
  isTerminalState,
  isValidPaymentAmount,
  isValidTransition,
  isVerificationTimedOut,
  type Message,
  normalizeMessageRole,
  type PaymentAttempt,
  type PaymentAttemptStatus,
  pickDefaultModel,
  rawUsdcToUsdCents,
  toClientVisibleStatus,
  trimConversationHistory,
  usdCentsToCredits,
  usdCentsToRawUsdc,
  usdToCredits,
} from "../../packages/node-core/src/index.ts";

const ROOT = process.cwd();
const FIXTURES_DIR = path.join(ROOT, "services/rust-node/fixtures/generated");

async function json(value: unknown): Promise<string> {
  const serialized = JSON.stringify(
    value,
    (_key, current) => {
      if (typeof current === "bigint") return current.toString();
      if (current instanceof Date) return current.toISOString();
      return current;
    },
    2
  );
  return prettier.format(serialized, { filepath: "fixture.json" });
}

function errorShape(error: unknown) {
  if (error instanceof Error) {
    const result: Record<string, unknown> = {
      name: error.name,
      message: error.message,
    };
    for (const key of Object.keys(error)) {
      result[key] = (error as Record<string, unknown>)[key];
    }
    if (typeof (error as { shortfall?: unknown }).shortfall === "number") {
      result.shortfall = (error as { shortfall: number }).shortfall;
    }
    return result;
  }
  return { message: String(error) };
}

function runCase<TInput>(input: TInput, fn: (value: TInput) => unknown) {
  try {
    return { kind: "ok", value: fn(input) };
  } catch (error) {
    return { kind: "error", value: errorShape(error) };
  }
}

const accountA: Account = { id: "acct_alpha", balanceCredits: 100 };
const accountZero: Account = { id: "acct_zero", balanceCredits: 0 };
const accountDecimal: Account = { id: "acct_decimal", balanceCredits: 10.5 };

const chatMessages: Message[] = [
  { role: "system", content: "ignore me" },
  { role: "user", content: "hello" },
  { role: "assistant", content: "world" },
];

const longHistory: Message[] = [
  { role: "user", content: "a".repeat(20) },
  { role: "assistant", content: "b".repeat(20) },
  { role: "user", content: "c".repeat(20) },
];

const emojiMessage = { role: "user", content: "hi 👋" } satisfies Message;

const paymentAttemptBase: PaymentAttempt = {
  id: "pay_123",
  billingAccountId: "billing_alpha",
  fromAddress: "0xabc",
  chainId: 11155111,
  token: "0xtoken",
  toAddress: "0xdao",
  amountRaw: 1_000_000n,
  amountUsdCents: 100,
  status: "CREATED_INTENT",
  txHash: null,
  errorCode: null,
  expiresAt: new Date("2026-04-20T12:30:00.000Z"),
  submittedAt: null,
  lastVerifyAttemptAt: null,
  verifyAttemptCount: 0,
  createdAt: new Date("2026-04-20T12:00:00.000Z"),
};

const coreFixtures = {
  accounts: {
    hasSufficientCredits: [
      {
        name: "balance-greater-than-cost",
        input: { account: accountA, cost: 50 },
        result: hasSufficientCredits(accountA, 50),
      },
      {
        name: "balance-equals-cost",
        input: { account: accountA, cost: 100 },
        result: hasSufficientCredits(accountA, 100),
      },
      {
        name: "decimal-threshold",
        input: { account: accountDecimal, cost: 10.6 },
        result: hasSufficientCredits(accountDecimal, 10.6),
      },
    ],
    ensureHasCredits: [
      {
        name: "passes-when-funded",
        input: { account: accountA, cost: 25 },
        result: runCase(
          { account: accountA, cost: 25 },
          ({ account, cost }) => {
            ensureHasCredits(account, cost);
            return null;
          }
        ),
      },
      {
        name: "throws-when-insufficient",
        input: { account: accountA, cost: 150 },
        result: runCase(
          { account: accountA, cost: 150 },
          ({ account, cost }) => {
            ensureHasCredits(account, cost);
            return null;
          }
        ),
      },
      {
        name: "zero-balance-rejects-positive-cost",
        input: { account: accountZero, cost: 0.01 },
        result: runCase(
          { account: accountZero, cost: 0.01 },
          ({ account, cost }) => {
            ensureHasCredits(account, cost);
            return null;
          }
        ),
      },
    ],
  },
  ai: {
    applyBaselineSystemPrompt: [
      {
        name: "removes-existing-system-messages",
        input: { messages: chatMessages },
        result: applyBaselineSystemPrompt(chatMessages),
      },
    ],
    estimateTotalTokens: [
      {
        name: "counts-utf16-code-units",
        input: {
          messages: [emojiMessage, { role: "assistant", content: "done" }],
        },
        result: estimateTotalTokens([
          emojiMessage,
          { role: "assistant", content: "done" },
        ]),
      },
    ],
    constants: {
      baselineSystemPrompt: BASELINE_SYSTEM_PROMPT,
    },
  },
  billing: {
    usdToCredits: [
      {
        name: "tiny-fraction-rounds-up",
        input: { usd: 0.00000001 },
        result: usdToCredits(0.00000001),
      },
      { name: "one-dollar", input: { usd: 1 }, result: usdToCredits(1) },
    ],
    creditsToUsd: [
      {
        name: "full-dollar",
        input: { credits: 10_000_000n },
        result: creditsToUsd(10_000_000n),
      },
    ],
    usdCentsToCredits: [
      {
        name: "positive-cents",
        input: { amountUsdCents: 99 },
        result: runCase(99, (value) => usdCentsToCredits(value)),
      },
      {
        name: "negative-cents-rejected",
        input: { amountUsdCents: -1 },
        result: runCase(-1, (value) => usdCentsToCredits(value)),
      },
    ],
    calculateLlmUserCharge: [
      {
        name: "markup-charge",
        input: { providerCostUsd: 0.0006261, markupFactor: 2 },
        result: calculateLlmUserCharge(0.0006261, 2),
      },
    ],
    calculateOpenRouterTopUp: [
      {
        name: "standard-top-up",
        input: {
          amountUsdCents: 1000,
          markupFactor: 2,
          revenueShare: 0.75,
          cryptoFee: 0.05,
        },
        result: calculateOpenRouterTopUp(1000, 2, 0.75, 0.05),
      },
      {
        name: "invalid-denominator-clamps-zero",
        input: {
          amountUsdCents: 100,
          markupFactor: 2,
          revenueShare: 0.75,
          cryptoFee: 1,
        },
        result: calculateOpenRouterTopUp(100, 2, 0.75, 1),
      },
    ],
    calculateRevenueShareBonus: [
      {
        name: "floors-fractional-bonus",
        input: { purchasedCredits: 3n, revenueShare: 0.75 },
        result: calculateRevenueShareBonus(3n, 0.75),
      },
      {
        name: "non-positive-share-mints-zero",
        input: { purchasedCredits: 100_000_000n, revenueShare: -0.5 },
        result: calculateRevenueShareBonus(100_000_000n, -0.5),
      },
    ],
    isMarginPreserved: [
      {
        name: "profitable-margin",
        input: { markupFactor: 2, revenueShare: 0.75, cryptoFee: 0.05 },
        result: isMarginPreserved(2, 0.75, 0.05),
      },
      {
        name: "lossy-margin",
        input: { markupFactor: 1.5, revenueShare: 0.75, cryptoFee: 0.05 },
        result: isMarginPreserved(1.5, 0.75, 0.05),
      },
    ],
  },
  chat: {
    assertMessageLength: [
      {
        name: "emoji-counts-as-single-character",
        input: { content: "hi 👋", maxChars: 4 },
        result: runCase(
          { content: "hi 👋", maxChars: 4 },
          ({ content, maxChars }) => {
            assertMessageLength(content, maxChars);
            return null;
          }
        ),
      },
      {
        name: "overflow-throws-validation-error",
        input: { content: "x".repeat(4001), maxChars: 4000 },
        result: runCase(
          { content: "x".repeat(4001), maxChars: 4000 },
          ({ content, maxChars }) => {
            assertMessageLength(content, maxChars);
            return null;
          }
        ),
      },
    ],
    trimConversationHistory: [
      {
        name: "drops-oldest-until-limit",
        input: { messages: longHistory, maxChars: 45 },
        result: trimConversationHistory(longHistory, 45),
      },
    ],
    filterSystemMessages: [
      {
        name: "removes-system-role",
        input: { messages: chatMessages },
        result: filterSystemMessages(chatMessages),
      },
    ],
    normalizeMessageRole: [
      {
        name: "normalizes-user",
        input: { role: "  USER  " },
        result: normalizeMessageRole("  USER  "),
      },
      {
        name: "rejects-invalid-role",
        input: { role: "bot" },
        result: normalizeMessageRole("bot"),
      },
    ],
    pickDefaultModel: [
      {
        name: "positive-balance-prefers-user-choice",
        input: {
          balanceCredits: 10,
          userChoice: "gpt-4o-mini",
          defaultFreeModelId: "free-model",
          defaultPaidModelId: "paid-model",
        },
        result: pickDefaultModel({
          balanceCredits: 10,
          userChoice: "gpt-4o-mini",
          defaultFreeModelId: "free-model",
          defaultPaidModelId: "paid-model",
        }),
      },
      {
        name: "zero-balance-falls-back-to-free",
        input: {
          balanceCredits: 0,
          userChoice: "paid-model",
          defaultFreeModelId: "free-model",
          defaultPaidModelId: "paid-model",
        },
        result: pickDefaultModel({
          balanceCredits: 0,
          userChoice: "paid-model",
          defaultFreeModelId: "free-model",
          defaultPaidModelId: "paid-model",
        }),
      },
    ],
  },
  payments: {
    isValidTransition: [
      {
        name: "created-to-pending",
        input: { from: "CREATED_INTENT", to: "PENDING_UNVERIFIED" },
        result: isValidTransition("CREATED_INTENT", "PENDING_UNVERIFIED"),
      },
      {
        name: "terminal-to-anything-false",
        input: { from: "FAILED", to: "CREDITED" },
        result: isValidTransition("FAILED", "CREDITED"),
      },
    ],
    isValidPaymentAmount: [
      {
        name: "minimum-bound",
        input: { amountUsdCents: 200 },
        result: isValidPaymentAmount(200),
      },
      {
        name: "below-minimum",
        input: { amountUsdCents: 199 },
        result: isValidPaymentAmount(199),
      },
    ],
    isIntentExpired: [
      {
        name: "created-intent-expires-after-deadline",
        input: {
          attempt: paymentAttemptBase,
          now: new Date("2026-04-20T12:31:00.000Z"),
        },
        result: isIntentExpired(
          paymentAttemptBase,
          new Date("2026-04-20T12:31:00.000Z")
        ),
      },
      {
        name: "missing-expiration-is-not-expired",
        input: {
          attempt: { ...paymentAttemptBase, expiresAt: null },
          now: new Date("2026-04-20T12:31:00.000Z"),
        },
        result: isIntentExpired(
          { ...paymentAttemptBase, expiresAt: null },
          new Date("2026-04-20T12:31:00.000Z")
        ),
      },
    ],
    isVerificationTimedOut: [
      {
        name: "pending-expires-after-ttl",
        input: {
          attempt: {
            ...paymentAttemptBase,
            status: "PENDING_UNVERIFIED" satisfies PaymentAttemptStatus,
            expiresAt: null,
            submittedAt: new Date("2026-04-19T11:00:00.000Z"),
          },
          now: new Date("2026-04-20T12:00:00.000Z"),
        },
        result: isVerificationTimedOut(
          {
            ...paymentAttemptBase,
            status: "PENDING_UNVERIFIED",
            expiresAt: null,
            submittedAt: new Date("2026-04-19T11:00:00.000Z"),
          },
          new Date("2026-04-20T12:00:00.000Z")
        ),
      },
    ],
    isTerminalState: [
      {
        name: "credited-terminal",
        input: { status: "CREDITED" },
        result: isTerminalState("CREDITED"),
      },
      {
        name: "pending-not-terminal",
        input: { status: "PENDING_UNVERIFIED" },
        result: isTerminalState("PENDING_UNVERIFIED"),
      },
    ],
    toClientVisibleStatus: [
      {
        name: "credited-becomes-confirmed",
        input: { status: "CREDITED" },
        result: toClientVisibleStatus("CREDITED"),
      },
      {
        name: "failed-becomes-failed",
        input: { status: "FAILED" },
        result: toClientVisibleStatus("FAILED"),
      },
    ],
    usdCentsToRawUsdc: [
      {
        name: "one-dollar",
        input: { amountUsdCents: 100 },
        result: usdCentsToRawUsdc(100),
      },
      {
        name: "zero",
        input: { amountUsdCents: 0 },
        result: usdCentsToRawUsdc(0),
      },
    ],
    rawUsdcToUsdCents: [
      {
        name: "round-trip-whole-dollar",
        input: { amountRaw: 1_000_000n },
        result: rawUsdcToUsdCents(1_000_000n),
      },
      {
        name: "fractional-truncation",
        input: { amountRaw: 12_345n },
        result: rawUsdcToUsdCents(12_345n),
      },
    ],
  },
};

const contractSummary = {
  "meta.livez.read.v1": {
    input: null,
    output: z.toJSONSchema(metaLivezOutputSchema),
  },
  "meta.readyz.read.v1": {
    input: null,
    output: z.toJSONSchema(metaReadyzOutputSchema),
  },
  "graph-runs.create.internal.v1": {
    input: {
      required: InternalCreateGraphRunInputSchema.shape.runId ? ["runId"] : [],
      runKind: GraphRunKindSchema.options,
    },
    output: z.toJSONSchema(InternalCreateGraphRunOutputSchema),
  },
  "graph-runs.update.internal.v1": {
    input: {
      required: ["status"],
      status: GraphRunUpdateStatusSchema.options,
    },
    output: z.toJSONSchema(InternalUpdateGraphRunOutputSchema),
  },
  "grants.validate.internal.v1": {
    input: {
      required: ["graphId"],
      schema: z.toJSONSchema(InternalValidateGrantInputSchema),
    },
    output: {
      errorCodes: GrantValidationErrorCode.options,
      schema: z.toJSONSchema(InternalValidateGrantOutputSchema),
    },
  },
  "graphs.run.internal.v1": {
    input: {
      required: ["input"],
      schema: z.toJSONSchema(InternalGraphRunInputSchema),
    },
    output: {
      aiExecutionErrorCodes: AI_EXECUTION_ERROR_CODES,
      schema: z.toJSONSchema(InternalGraphRunOutputSchema),
    },
  },
};

const contractFixtures = {
  summary: {
    "meta.livez.read.v1": {
      input: { kind: "null" },
      output: {
        type: "object",
        required: ["status", "timestamp"],
        properties: {
          status: { enum: ["alive"] },
          timestamp: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    "meta.readyz.read.v1": {
      input: { kind: "null" },
      output: {
        type: "object",
        required: ["status", "timestamp"],
        properties: {
          status: { enum: ["healthy"] },
          timestamp: { type: "string" },
          version: { kind: "optional-string" },
        },
        additionalProperties: false,
      },
    },
    "graph-runs.create.internal.v1": {
      input: {
        type: "object",
        required: ["runId"],
        properties: {
          runId: { type: "string" },
          graphId: { kind: "optional-string" },
          runKind: {
            kind: "optional-enum",
            enum: contractSummary["graph-runs.create.internal.v1"].input
              .runKind,
          },
          triggerSource: { kind: "optional-string" },
          triggerRef: { kind: "optional-string" },
          requestedBy: { kind: "optional-string" },
          scheduleId: { kind: "optional-string" },
          scheduledFor: { kind: "optional-string" },
          stateKey: { kind: "optional-string" },
        },
        additionalProperties: false,
      },
      output: {
        type: "object",
        required: ["ok", "runId"],
        properties: {
          ok: { const: true },
          runId: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    "graph-runs.update.internal.v1": {
      input: {
        type: "object",
        required: ["status"],
        properties: {
          status: {
            enum: contractSummary["graph-runs.update.internal.v1"].input.status,
          },
          traceId: { kind: "optional-nullable-string" },
          errorMessage: { kind: "optional-string" },
          errorCode: { kind: "optional-string" },
        },
        additionalProperties: false,
      },
      output: {
        type: "object",
        required: ["ok", "runId"],
        properties: {
          ok: { const: true },
          runId: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    "grants.validate.internal.v1": {
      input: {
        type: "object",
        required: ["graphId"],
        properties: {
          graphId: { type: "string" },
        },
        additionalProperties: false,
      },
      output: {
        type: "object",
        required: ["ok", "grant"],
        properties: {
          ok: { const: true },
          grant: {
            type: "object",
            required: [
              "id",
              "userId",
              "billingAccountId",
              "scopes",
              "expiresAt",
              "revokedAt",
              "createdAt",
            ],
            properties: {
              id: { type: "string" },
              userId: { type: "string" },
              billingAccountId: { type: "string" },
              scopes: { kind: "string-array" },
              expiresAt: { kind: "nullable-string" },
              revokedAt: { kind: "nullable-string" },
              createdAt: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      errorOutput: {
        type: "object",
        required: ["ok", "error"],
        properties: {
          ok: { const: false },
          error: {
            enum: contractSummary["grants.validate.internal.v1"].output
              .errorCodes,
          },
        },
        additionalProperties: false,
      },
    },
    "graphs.run.internal.v1": {
      input: {
        type: "object",
        required: ["input"],
        properties: {
          executionGrantId: { kind: "optional-nullable-string" },
          input: { kind: "record" },
          runId: { kind: "optional-string" },
        },
        additionalProperties: false,
      },
      output: {
        kind: "discriminated-union",
        discriminator: "ok",
        variants: [
          {
            ok: true,
            required: ["ok", "runId", "traceId"],
            properties: {
              runId: { type: "string" },
              traceId: { kind: "nullable-string" },
              structuredOutput: { kind: "optional-unknown" },
            },
          },
          {
            ok: false,
            required: ["ok", "runId", "traceId", "error"],
            properties: {
              runId: { type: "string" },
              traceId: { kind: "nullable-string" },
              error: { enum: AI_EXECUTION_ERROR_CODES },
            },
          },
        ],
      },
    },
  },
  source: contractSummary,
};

await fs.mkdir(FIXTURES_DIR, { recursive: true });
await fs.writeFile(
  path.join(FIXTURES_DIR, "node-core.parity.json"),
  await json(coreFixtures)
);
await fs.writeFile(
  path.join(FIXTURES_DIR, "node-contracts.summary.json"),
  await json(contractFixtures)
);
console.log(`wrote fixtures to ${FIXTURES_DIR}`);
