"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  BrainCircuit,
  CheckCircle,
  Loader2,
  Search,
} from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../lib/cn";

/* ─── Types ─────────────────────────────────────── */

interface StreamEvent {
  id: string;
  type: "thinking" | "searching" | "analyzing" | "signal" | "done";
  text: string;
  timestamp: number;
}

/* ─── Simulated stream events ───────────────────── */

const STREAM_SEQUENCES: StreamEvent[][] = [
  [
    {
      id: "a1",
      type: "thinking",
      text: "Checking macro calendar for upcoming catalysts...",
      timestamp: 0,
    },
    {
      id: "a2",
      type: "searching",
      text: "Scanning Kalshi climate markets — 23 active contracts",
      timestamp: 1800,
    },
    {
      id: "a3",
      type: "analyzing",
      text: "NOAA updated Gulf SST anomaly to +1.8C — comparing to hurricane model base rates",
      timestamp: 3400,
    },
    {
      id: "a4",
      type: "signal",
      text: 'Signal: "Cat 5 hurricane hits US" — Kalshi 41c, model says 46c. Moderate edge detected.',
      timestamp: 5600,
    },
    {
      id: "a5",
      type: "done",
      text: "Scan complete. 1 signal generated, 23 markets reviewed.",
      timestamp: 7200,
    },
  ],
  [
    {
      id: "b1",
      type: "thinking",
      text: "Reviewing Fed futures curve vs Kalshi rate-cut pricing...",
      timestamp: 0,
    },
    {
      id: "b2",
      type: "searching",
      text: "Pulling CME FedWatch probabilities and CPI trend data",
      timestamp: 2000,
    },
    {
      id: "b3",
      type: "analyzing",
      text: 'Kalshi "June cut" at 62c — FedWatch implies 68%. Spread: 6c mispricing.',
      timestamp: 3800,
    },
    {
      id: "b4",
      type: "signal",
      text: 'Signal: "Fed cuts at June meeting" — Buy Yes at 62c, target 68c. High confidence.',
      timestamp: 5400,
    },
    {
      id: "b5",
      type: "done",
      text: "Scan complete. 1 signal generated, 8 markets reviewed.",
      timestamp: 6800,
    },
  ],
  [
    {
      id: "c1",
      type: "thinking",
      text: "Monitoring Polymarket tech category for new listings...",
      timestamp: 0,
    },
    {
      id: "c2",
      type: "searching",
      text: "3 new markets detected — GPT-5, Apple AI, Anthropic funding round",
      timestamp: 1600,
    },
    {
      id: "c3",
      type: "analyzing",
      text: "GPT-5 before July: 34c. No credible leaks. Historical AI release markets have 12% optimism bias.",
      timestamp: 3200,
    },
    {
      id: "c4",
      type: "analyzing",
      text: "Anthropic $10B+ round: 78c. Multiple credible sources. Fair price — no actionable edge.",
      timestamp: 4800,
    },
    {
      id: "c5",
      type: "done",
      text: "Scan complete. 0 signals — no edge detected in current tech markets.",
      timestamp: 6200,
    },
  ],
];

/* ─── Event icon ────────────────────────────────── */

function EventIcon({ type }: { type: StreamEvent["type"] }): ReactElement {
  switch (type) {
    case "thinking":
      return <BrainCircuit className="size-3 text-primary" />;
    case "searching":
      return <Search className="size-3 text-muted-foreground" />;
    case "analyzing":
      return <Activity className="size-3 text-up" />;
    case "signal":
      return <Activity className="size-3 text-up" />;
    case "done":
      return <CheckCircle className="size-3 text-muted-foreground" />;
  }
}

/* ─── Main component ────────────────────────────── */

export function AgentStream(): ReactElement {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [seqIdx, setSeqIdx] = useState(0);
  const [isStreaming, setIsStreaming] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sequence = STREAM_SEQUENCES[seqIdx % STREAM_SEQUENCES.length];
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    setEvents([]);
    setIsStreaming(true);

    for (const event of sequence) {
      timeouts.push(
        setTimeout(() => {
          setEvents((prev) => [...prev, event]);
        }, event.timestamp)
      );
    }

    // After sequence ends, pause then start next
    const lastEvent = sequence[sequence.length - 1];
    timeouts.push(
      setTimeout(() => {
        setIsStreaming(false);
      }, lastEvent.timestamp + 500)
    );
    timeouts.push(
      setTimeout(() => {
        setSeqIdx((prev) => prev + 1);
      }, lastEvent.timestamp + 4000)
    );

    return () => {
      for (const t of timeouts) clearTimeout(t);
    };
  }, [seqIdx]);

  // Auto-scroll to bottom when new events arrive
  const eventCount = events.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: eventCount triggers scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [eventCount]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.5 }}
      className="mx-auto mt-12 w-full max-w-lg"
    >
      <div className="overflow-hidden rounded-lg border border-border/40 bg-card/80 backdrop-blur-md">
        {/* Header */}
        <div className="flex items-center gap-2 border-border/40 border-b px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            {isStreaming ? (
              <Loader2 className="size-3 animate-spin text-primary" />
            ) : (
              <CheckCircle className="size-3 text-muted-foreground" />
            )}
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
              {isStreaming ? "Agent running" : "Scan complete"}
            </span>
          </div>
          <div className="flex-1" />
          <span className="font-mono text-[10px] text-muted-foreground/50">
            cogni/brain
          </span>
        </div>

        {/* Stream output */}
        <div
          ref={scrollRef}
          className="h-[140px] overflow-y-auto px-4 py-3 sm:h-[160px]"
        >
          <AnimatePresence mode="popLayout">
            {events.map((event) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="mb-2 flex items-start gap-2 last:mb-0"
              >
                <span className="mt-0.5 shrink-0">
                  <EventIcon type={event.type} />
                </span>
                <span
                  className={cn(
                    "font-mono text-xs leading-relaxed",
                    event.type === "signal"
                      ? "text-up"
                      : event.type === "done"
                        ? "text-muted-foreground/60"
                        : "text-muted-foreground"
                  )}
                >
                  {event.text}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Typing indicator */}
          {isStreaming && events.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-1 pt-1"
            >
              <span className="size-1 animate-pulse rounded-full bg-primary/60" />
              <span
                className="size-1 animate-pulse rounded-full bg-primary/60"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="size-1 animate-pulse rounded-full bg-primary/60"
                style={{ animationDelay: "300ms" }}
              />
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
