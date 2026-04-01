"use client";

import { motion } from "framer-motion";
import { ArrowRight, TrendingUp } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

import { AgentStream } from "./AgentStream";
import { NeuralNetworkBackground } from "./NeuralNetwork";

/** Oscillating sentiment counter: +1000 (green) ↔ -1000 (red) */
function SentimentCounter(): ReactElement {
  const [value, setValue] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setValue((prev) => {
        const step = Math.floor(Math.random() * 80) + 20;
        const next = prev + step * direction;
        if (next >= 1000) {
          setDirection(-1);
          return 1000;
        }
        if (next <= -1000) {
          setDirection(1);
          return -1000;
        }
        return next;
      });
    }, 50);
    return () => clearInterval(interval);
  }, [direction]);

  const isPositive = value >= 0;
  const absStr = String(Math.abs(value)).padStart(4, "0");
  const display = isPositive ? `+${absStr}` : `-${absStr}`;

  return (
    <span className="inline-flex items-center gap-2 font-mono text-sm tracking-widest">
      <span
        className={cn(
          "inline-block size-2 rounded-full transition-colors duration-300",
          isPositive ? "bg-up" : "bg-down"
        )}
      />
      <span
        className={cn(
          "tabular-nums transition-colors duration-300",
          isPositive ? "text-up" : "text-down"
        )}
      >
        {display}
      </span>
    </span>
  );
}

export function Hero(): ReactElement {
  return (
    <section
      className={cn(
        "relative flex w-full flex-col items-center justify-center overflow-hidden bg-background px-4 pt-28 pb-16 sm:px-6 sm:pt-32 sm:pb-20"
      )}
    >
      {/* Three.js neural network background */}
      <NeuralNetworkBackground />

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        {/* Status bar — resy-style animated counter */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8 inline-flex items-center gap-3 rounded-full border border-border/60 bg-background/60 px-4 py-2 backdrop-blur-sm"
        >
          <TrendingUp className="size-3.5 text-primary" />
          <span className="text-muted-foreground text-xs uppercase tracking-widest">
            Scanning markets
          </span>
          <SentimentCounter />
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="font-bold text-4xl tracking-tight sm:text-6xl lg:text-7xl"
        >
          <span className="text-foreground">Bet smarter.</span>
          <br />
          <span className="text-gradient-accent">Together.</span>
        </motion.h1>

        {/* Subhead */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground sm:text-xl"
        >
          A community-built AI that researches, monitors, and signals
          <br className="hidden sm:block" /> across Polymarket, Kalshi, and
          more. You stay in control.
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
        >
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
          >
            Join the community
            <ArrowRight className="size-4" />
          </button>
          <span className="text-muted-foreground text-xs uppercase tracking-widest">
            Teach it. Guide it. Profit with it.
          </span>
        </motion.div>

        {/* Live agent stream */}
        <AgentStream />
      </div>
    </section>
  );
}
