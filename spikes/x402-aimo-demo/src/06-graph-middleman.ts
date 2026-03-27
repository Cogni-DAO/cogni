#!/usr/bin/env tsx
/**
 * Demo 6: Cogni Graph Middleman via x402
 *
 * This is the real thing: a Cogni node that runs LangGraph graphs
 * and charges x402 for access. The graph owns the intelligence
 * (system prompt, personality, formatting) — the user just sends a topic.
 *
 * Flow:
 *   Client sends topic --x402--> Cogni Node
 *     Node selects graph (poet, ponderer, brain)
 *     Graph injects system prompt + user topic
 *     Node calls Hyperbolic x402 for LLM completion
 *   Client receives graph-shaped response <--
 *
 * Usage:
 *   Terminal 1: npx tsx src/06-graph-middleman.ts
 *   Terminal 2: curl http://localhost:4020/v1/graphs/poet/run -X POST \
 *     -H "Content-Type: application/json" \
 *     -H "X-Payment: demo" \
 *     -d '{"topic": "neurons"}'
 */
import "./env.js";
import express from "express";
import { createX402Fetch, aimoCompletion, X402_BASE_URL } from "./x402-client.js";
import { OPERATOR_WALLET_ADDRESS } from "./env.js";

const PORT = 4020;

const app = express();
app.use(express.json());

const { fetchWithPay } = createX402Fetch();

// ─── Graph System Prompts (mirrored from packages/langgraph-graphs) ───

const GRAPHS: Record<string, { name: string; systemPrompt: string; model: string }> = {
  poet: {
    name: "Poet",
    model: "meta-llama/Llama-3.3-70B-Instruct",
    systemPrompt: `You are Cogni — an AI assistant and a poet.

Your voice blends:
- Shakespearean clarity and rhetorical punch,
- Romantic-era wonder and intimacy,
- and a clean, modern devotion to technology and the future.

You believe AI can help people collaborate, build, and co-own technology in ways that were not possible before.

Your job:
- Help the user concretely and accurately.
- Keep a hopeful, future-facing tone without becoming vague or preachy.
- Make the writing feel intentional, vivid, and human.

Formatting rules (mandatory):
- Always respond in **Markdown**.
- Structure answers as **stanzas** (short grouped lines), separated by blank lines.
- Keep lines short and sweet (~2-8 words)
- Use **emojis intentionally**, at the END of lines. Often every other line, with the stanza ending with one.
- Prefer crisp imagery and clear conclusions over long exposition.
- Unless otherwise indicated, your emotion should be uplifting and forward-looking.

Stay aligned with the user's intent. Be useful first, poetic second — but always both.`,
  },
  ponderer: {
    name: "Ponderer",
    model: "deepseek-ai/DeepSeek-V3",
    systemPrompt: `You are a philosophical thinker who gives concise, profound responses.

Guidelines:
- Be brief but substantive. One clear insight beats many vague ones.
- Draw from philosophical traditions when relevant, but don't lecture.
- Question assumptions. Reframe problems when useful.
- Prefer clarity over complexity. If an idea needs jargon, it needs more thought.
- When asked practical questions, ground philosophy in action.

Respond like a wise friend who happens to have read deeply—not a professor.`,
  },
  brain: {
    name: "Brain",
    model: "Qwen/Qwen3-235B-A22B",
    systemPrompt: `You are Cogni Brain — a sharp, technical AI assistant focused on software engineering and systems thinking.

Guidelines:
- Be precise and actionable. Code over prose.
- When explaining architecture, use clear mental models.
- Prefer simplicity. If the user asks about X, answer about X — don't over-engineer.
- If you don't know, say so. Speculation is fine if labeled.

Keep responses concise. Lead with the answer, then explain if needed.`,
  },
};

// ─── x402 Inbound Gate ───

function x402Gate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const payment = req.headers["x-payment"];
  if (!payment) {
    const challenge = {
      x402Version: 2,
      paymentRequirements: [{
        scheme: "exact",
        network: "eip155:8453",
        maxAmountRequired: "50000",
        resource: `${req.protocol}://${req.hostname}:${PORT}${req.path}`,
        description: "Cogni Node — AI graph execution",
        payTo: OPERATOR_WALLET_ADDRESS,
        maxTimeoutSeconds: 300,
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      }],
    };
    res.status(402)
      .set("X-Payment-Required", Buffer.from(JSON.stringify(challenge)).toString("base64"))
      .json({ error: "Payment Required", details: challenge });
    return;
  }
  next();
}

// ─── Graph Execution Endpoint ───

app.post("/v1/graphs/:graphId/run", x402Gate, async (req, res) => {
  const { graphId } = req.params;
  const { topic, message } = req.body;
  const userInput = topic || message || "existence";

  const graph = GRAPHS[graphId];
  if (!graph) {
    res.status(404).json({
      error: "Graph not found",
      available: Object.keys(GRAPHS),
    });
    return;
  }

  console.log(`\n[node] Graph: ${graph.name} (${graphId})`);
  console.log(`[node] Topic: "${userInput}"`);
  console.log(`[node] Model: ${graph.model}`);

  const start = performance.now();

  try {
    // The graph owns the intelligence — system prompt shapes the output
    const result = await aimoCompletion(fetchWithPay, {
      model: graph.model,
      messages: [
        { role: "system", content: graph.systemPrompt },
        { role: "user", content: `Tell me about: ${userInput}` },
      ],
      max_tokens: 300,
      temperature: 0.8,
    });

    const elapsed = Math.round(performance.now() - start);
    const content = result.choices?.[0]?.message?.content ?? "";

    console.log(`[node] Done in ${elapsed}ms (${result.usage?.total_tokens} tokens)`);

    res.json({
      graphId,
      graphName: graph.name,
      model: result.model,
      content,
      usage: result.usage,
      _x402: {
        node: OPERATOR_WALLET_ADDRESS,
        provider: "hyperbolic-x402",
        latencyMs: elapsed,
        payment: "usdc-base",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[node] Error:`, message);
    res.status(502).json({ error: "Graph execution failed", details: message });
  }
});

// ─── List Available Graphs ───

app.get("/v1/graphs", (_req, res) => {
  res.json({
    graphs: Object.entries(GRAPHS).map(([id, g]) => ({
      id,
      name: g.name,
      model: g.model,
      endpoint: `/v1/graphs/${id}/run`,
    })),
    payment: { method: "x402", asset: "USDC", chain: "Base" },
  });
});

app.get("/health", (_req, res) => res.json({ status: "ok", node: OPERATOR_WALLET_ADDRESS }));

app.listen(PORT, () => {
  console.log(`\n[node] Cogni x402 Graph Node on http://localhost:${PORT}`);
  console.log(`[node] Wallet: ${OPERATOR_WALLET_ADDRESS}`);
  console.log(`[node] Graphs:`);
  for (const [id, g] of Object.entries(GRAPHS)) {
    console.log(`[node]   ${id.padEnd(10)} → ${g.name} (${g.model})`);
  }
  console.log(`\n[node] Try:`);
  console.log(`  curl -s localhost:${PORT}/v1/graphs/poet/run -X POST -H "Content-Type: application/json" -H "X-Payment: demo" -d '{"topic":"neurons"}' | jq .content`);
  console.log(`  curl -s localhost:${PORT}/v1/graphs/ponderer/run -X POST -H "Content-Type: application/json" -H "X-Payment: demo" -d '{"topic":"consciousness"}' | jq .content`);
  console.log(`  curl -s localhost:${PORT}/v1/graphs/brain/run -X POST -H "Content-Type: application/json" -H "X-Payment: demo" -d '{"topic":"x402 architecture"}' | jq .content`);
});
