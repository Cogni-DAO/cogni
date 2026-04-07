// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/components/HomeStats`
 * Purpose: Scroll sections for the homepage — ownership, agents, and governance.
 * Scope: Homepage only. Does not fetch data.
 * Invariants: whileInView scroll animations; once:true for performance.
 * Side-effects: none
 * Links: src/app/(public)/page.tsx
 * @public
 */

"use client";

import { motion } from "framer-motion";
import { Bot, GitBranch, Layers, Zap } from "lucide-react";
import type { ReactElement } from "react";

/* ─── Heartbeat dot (from poly) ─────────────────────── */

function HeartbeatDot({
  color = "bg-emerald-400",
}: {
  color?: string;
}): ReactElement {
  return (
    <span className="relative flex size-2.5">
      <span
        className={`absolute inline-flex size-full animate-ping rounded-full opacity-75 ${color}`}
      />
      <span className={`relative inline-flex size-2.5 rounded-full ${color}`} />
    </span>
  );
}

/* ─── How it works ───────────────────────────────────── */

const HOW_IT_WORKS = [
  {
    icon: GitBranch,
    label: "Contribute",
    body: "Push code, data, or compute. Every contribution is tracked on-chain.",
  },
  {
    icon: Zap,
    label: "Earn",
    body: "Contributions mint ownership tokens — proportional to impact, not hours.",
  },
  {
    icon: Bot,
    label: "Govern",
    body: "Token holders vote on agent direction, treasury allocation, and upgrades.",
  },
  {
    icon: Layers,
    label: "Scale",
    body: "AI builds AI. Agents spawn sub-agents. The graph grows until it doesn't need you.",
  },
];

function HowItWorksSection(): ReactElement {
  return (
    <section className="w-full bg-background py-20 md:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-12"
        >
          <span className="font-mono text-primary text-xs uppercase tracking-widest">
            How it works
          </span>
          <h2 className="mt-3 font-bold text-3xl tracking-tight sm:text-4xl">
            Give work. Get ownership.
          </h2>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="rounded-lg border border-border/40 bg-card p-5 transition-colors hover:border-border/80"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded-sm bg-secondary p-1.5">
                    <Icon className="size-4 text-primary" />
                  </span>
                  <span className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mb-1.5 font-semibold text-foreground text-sm">
                  {step.label}
                </h3>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {step.body}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─── Stack section ──────────────────────────────────── */

const STACK_ITEMS = [
  { label: "Data", detail: "Dolt version-controlled knowledge graphs" },
  { label: "Agents", detail: "LangGraph AI graphs, payable on-chain via x402" },
  { label: "Governance", detail: "Aragon DAO — token-weighted voting" },
  { label: "Infra", detail: "Docker + OpenTofu + Akash — fully open" },
];

function StackSection(): ReactElement {
  return (
    <section className="w-full border-border border-t bg-background py-20 md:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-12"
        >
          <span className="font-mono text-primary text-xs uppercase tracking-widest">
            The stack
          </span>
          <h2 className="mt-3 font-bold text-3xl tracking-tight sm:text-4xl">
            Web3 governance. Web2 intelligence.
          </h2>
          <p className="mt-3 max-w-lg text-muted-foreground text-sm">
            One codebase. Swap any layer.
          </p>
        </motion.div>

        {/* Status bar */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-8 flex flex-wrap items-center gap-4 rounded-lg border border-border/40 bg-card p-3"
        >
          <HeartbeatDot />
          <span className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
            Open source · MIT-compatible · Production-ready
          </span>
        </motion.div>

        <div className="space-y-3">
          {STACK_ITEMS.map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.07 }}
              className="group flex items-center justify-between rounded-lg border border-border/40 bg-card p-4 transition-colors hover:border-border/80"
            >
              <div className="flex items-center gap-4">
                <span className="font-mono text-muted-foreground/50 text-xs uppercase tracking-wider">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-semibold text-foreground text-sm">
                  {item.label}
                </span>
              </div>
              <span className="text-muted-foreground text-xs">
                {item.detail}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Combined export ────────────────────────────────── */

export function HomeStats(): ReactElement {
  return (
    <>
      <HowItWorksSection />
      <StackSection />
    </>
  );
}
