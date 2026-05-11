// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/runtimes/dev/view`
 * Purpose: Minimal "chat-with-your-local-agent" UI for the BYO-runtime dev console. Talks to the user's `cogni dev` server through a Cloudflare quick tunnel whose URL is supplied via `?baseUrl=`.
 * Scope: Client component. No state crosses the operator backend; messages live in component state for the lifetime of the tab.
 * Invariants:
 *   - INV-NO-OPERATOR-LLM: this view never calls the operator's LLM endpoints. Every message is forwarded to the user's tunnel; the operator is not in the data path of the agent's response.
 *   - INV-CAPABILITIES-FIRST: a runtime can only be selected if `/capabilities` reports it as installed.
 *   - INV-BASEURL-REQUIRED: without a `?baseUrl=` query param, the view shows pairing instructions instead of the chat UI.
 * Side-effects: IO (fetch to the tunnel URL; SSE stream parsing)
 * Links: packages/cogni-cli/src/dev/server.ts
 * @public
 */

"use client";

import { useSearchParams } from "next/navigation";
import {
  type FormEvent,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface Capability {
  kind: "claude" | "codex";
  installed: boolean;
  version: string | null;
}

interface CapabilityResponse {
  runtimes: Capability[];
  workdir: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  runtime?: "claude" | "codex";
}

const PAIRING_HINT = `Run on your laptop:

  pnpm --filter @cogni/cli build
  node packages/cogni-cli/dist/cli.js dev

(or, once published: \`pnpm dlx @cogni/cli dev\`)

The CLI will detect Claude Code and/or Codex, open a Cloudflare tunnel, and send you back here with \`?baseUrl=\` filled in.`;

function isHttpsTunnel(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost"
    );
  } catch {
    return false;
  }
}

async function fetchCapabilities(baseUrl: string): Promise<CapabilityResponse> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/capabilities`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`capabilities request failed (${res.status})`);
  return (await res.json()) as CapabilityResponse;
}

async function* streamRun(
  baseUrl: string,
  prompt: string,
  runtime: "claude" | "codex",
  signal: AbortSignal
): AsyncIterable<{ type: string; data?: string; code?: number }> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ prompt, runtime }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`run request failed (${res.status}): ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const line = event.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(6));
      } catch {
        // skip malformed events
      }
    }
  }
}

export function RuntimesDevView(): ReactElement {
  const searchParams = useSearchParams();
  const baseUrl = searchParams?.get("baseUrl") ?? null;

  const [capabilities, setCapabilities] = useState<CapabilityResponse | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<"claude" | "codex">("claude");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!baseUrl) return;
    if (!isHttpsTunnel(baseUrl)) {
      setError(
        "baseUrl must be an HTTPS tunnel (or 127.0.0.1 for local debugging)"
      );
      return;
    }
    let cancelled = false;
    fetchCapabilities(baseUrl)
      .then((caps) => {
        if (cancelled) return;
        setCapabilities(caps);
        const firstInstalled = caps.runtimes.find((r) => r.installed);
        if (firstInstalled) setRuntime(firstInstalled.kind);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  const installedRuntimes = useMemo(
    () => capabilities?.runtimes.filter((r) => r.installed) ?? [],
    [capabilities]
  );

  if (!baseUrl) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-12">
        <h1 className="font-semibold text-2xl">Runtimes · dev console</h1>
        <p className="text-muted-foreground">
          Pair your local Claude Code or Codex installation with this page by
          running the
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5">cogni dev</code>
          CLI on your device.
        </p>
        <pre className="whitespace-pre-wrap rounded border bg-muted/40 p-4 text-sm">
          {PAIRING_HINT}
        </pre>
      </main>
    );
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (running || !prompt.trim()) return;
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: prompt,
      runtime,
    };
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "",
      runtime,
    };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setPrompt("");
    setRunning(true);
    abortRef.current = new AbortController();
    try {
      for await (const evt of streamRun(
        baseUrl,
        userMessage.text,
        runtime,
        abortRef.current.signal
      )) {
        if (evt.type === "stdout" || evt.type === "stderr") {
          const chunk = evt.data ?? "";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessage.id ? { ...m, text: m.text + chunk } : m
            )
          );
        }
        if (evt.type === "done") break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessage.id
            ? { ...m, text: `${m.text}\n[error: ${message}]` }
            : m
        )
      );
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancel = (): void => {
    abortRef.current?.abort();
  };

  return (
    <main className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-6">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="font-semibold text-2xl">Runtimes · dev console</h1>
        <span className="text-muted-foreground text-sm">
          tunnel:{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">{baseUrl}</code>
        </span>
      </header>

      {error && (
        <div className="mb-4 rounded border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm">
          {error}
        </div>
      )}

      {capabilities && installedRuntimes.length === 0 && (
        <div className="mb-4 rounded border bg-muted/40 p-3 text-sm">
          Connected, but neither <code>claude</code> nor <code>codex</code> is
          on this device's PATH.
        </div>
      )}

      <ol className="mb-4 flex-1 space-y-3 overflow-auto rounded border bg-muted/20 p-4">
        {messages.length === 0 && (
          <li className="text-muted-foreground text-sm">
            Send a message — it will run on your local <code>{runtime}</code>{" "}
            binary and stream back here.
          </li>
        )}
        {messages.map((m) => (
          <li
            key={m.id}
            className={
              m.role === "user"
                ? "rounded bg-background px-3 py-2 text-sm"
                : "whitespace-pre-wrap rounded border bg-background px-3 py-2 font-mono text-sm"
            }
          >
            <div className="mb-1 text-muted-foreground text-xs">
              {m.role === "user" ? "you" : `${m.runtime ?? "agent"} →`}
            </div>
            {m.text || (m.role === "assistant" && running ? "…" : "")}
          </li>
        ))}
      </ol>

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-2 rounded border p-3"
      >
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            runtime
            <select
              value={runtime}
              onChange={(e) => setRuntime(e.target.value as "claude" | "codex")}
              className="rounded border bg-background px-2 py-1"
              disabled={running || installedRuntimes.length === 0}
            >
              {installedRuntimes.map((r) => (
                <option key={r.kind} value={r.kind}>
                  {r.kind} {r.version ? `(${r.version})` : ""}
                </option>
              ))}
              {installedRuntimes.length === 0 && (
                <option value="">(none installed)</option>
              )}
            </select>
          </label>
          {capabilities && (
            <span className="text-muted-foreground text-xs">
              workdir: {capabilities.workdir}
            </span>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask your local agent…"
          rows={3}
          className="w-full resize-y rounded border bg-background px-3 py-2 text-sm"
          disabled={running}
        />
        <div className="flex justify-end gap-2">
          {running && (
            <button
              type="button"
              onClick={cancel}
              className="rounded border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={
              running || !prompt.trim() || installedRuntimes.length === 0
            }
            className="rounded bg-primary px-3 py-1.5 text-primary-foreground text-sm disabled:opacity-50"
          >
            {running ? "Running…" : "Send"}
          </button>
        </div>
      </form>
    </main>
  );
}
