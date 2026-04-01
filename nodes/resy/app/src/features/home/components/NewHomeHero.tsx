// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

"use client";

import { motion } from "framer-motion";
import { ArrowRight, Zap } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/components";
import { cn } from "@/shared/util/cn";

import { useTryDemo } from "../hooks/useTryDemo";

function LatencyCounter(): ReactElement {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setMs((prev) => {
        if (prev >= 1200) return 0;
        return prev + Math.floor(Math.random() * 80) + 20;
      });
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="inline-flex items-center gap-2 font-mono text-sm tracking-widest">
      <span className="inline-block size-2 rounded-full bg-primary" />
      <span className="text-muted-foreground">
        {String(ms).padStart(4, "0")}
        <span className="opacity-60">ms</span>
      </span>
    </span>
  );
}

export function NewHomeHero(): ReactElement {
  const { handleTryDemo } = useTryDemo();

  return (
    <section
      className={cn(
        "relative flex w-full flex-col items-center justify-center overflow-hidden bg-background px-4 sm:px-6",
        "min-h-dvh"
      )}
    >
      {/* Content */}
      <div className="relative z-10 mx-auto max-w-4xl text-center">
        {/* Status bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8 inline-flex items-center gap-3 rounded-full border border-border/60 px-4 py-2"
        >
          <Zap className="size-3.5 text-primary" />
          <span className="text-muted-foreground text-xs uppercase tracking-widest">
            Watching for openings
          </span>
          <LatencyCounter />
        </motion.div>

        {/* Main headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="font-bold text-4xl tracking-tight sm:text-6xl lg:text-7xl"
        >
          <span className="text-foreground">Your table.</span>
          <br />
          <span className="text-gradient-accent">Not theirs.</span>
        </motion.h1>

        {/* Subhead */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground sm:text-xl"
        >
          Stop losing reservations to scalper bots.
          <br className="hidden sm:block" /> We claim your table in seconds,
          using official channels only.
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
        >
          <Button size="lg" onClick={handleTryDemo}>
            Get started
            <ArrowRight className="ml-2 size-4" />
          </Button>
          <span className="text-muted-foreground text-xs uppercase tracking-widest">
            One account. One table. No scalping.
          </span>
        </motion.div>
      </div>
    </section>
  );
}
