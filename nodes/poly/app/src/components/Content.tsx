"use client";

import { motion, useInView } from "framer-motion";
import {
  ArrowRight,
  Bell,
  BrainCircuit,
  Eye,
  Scale,
  Scan,
  TrendingDown,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useRef } from "react";

import { BrainFeed } from "./BrainFeed";
import { MarketCards } from "./MarketCards";

/* ─── How It Works ──────────────────────────────── */

interface StepProps {
  num: string;
  title: string;
  desc: string;
  icon: ReactNode;
  delay: number;
}

function Step({ num, title, desc, icon, delay }: StepProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -20 }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.5, delay }}
      className="group relative flex gap-6"
    >
      <div className="flex flex-col items-center">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-secondary">
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="w-px flex-1 bg-border/40" />
      </div>
      <div className="pb-12">
        <div className="flex items-center gap-3">
          <span className="font-mono text-primary text-xs uppercase tracking-widest">
            {num}
          </span>
          <h3 className="font-semibold text-foreground text-lg">{title}</h3>
        </div>
        <p className="mt-2 max-w-md text-muted-foreground text-sm leading-relaxed">
          {desc}
        </p>
      </div>
    </motion.div>
  );
}

function HowItWorks(): ReactElement {
  const steps: Omit<StepProps, "delay">[] = [
    {
      num: "01",
      title: "Shape the bot",
      desc: "Tell it what to watch. Set your criteria — markets, categories, probability thresholds. The community collectively trains its focus.",
      icon: <BrainCircuit className="size-4" />,
    },
    {
      num: "02",
      title: "It researches 24/7",
      desc: "The bot continuously scans Polymarket, Kalshi, and emerging platforms — reading news, tracking odds movement, and surfacing what matters.",
      icon: <Scan className="size-4" />,
    },
    {
      num: "03",
      title: "Signals when criteria hit",
      desc: "When a market matches your watchlist and the bot sees edge, you get a signal with its reasoning, confidence, and recommended position.",
      icon: <Bell className="size-4" />,
    },
    {
      num: "04",
      title: "You approve, it executes",
      desc: "Review the signal, approve or skip. Auto-approve rules for high-confidence plays, or stay fully hands-on. You're always in the loop.",
      icon: <UserCheck className="size-4" />,
    },
  ];

  return (
    <section
      id="how-it-works"
      className="w-full border-border/40 border-t bg-background py-20 md:py-28"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-16"
        >
          <span className="font-mono text-primary text-xs uppercase tracking-widest">
            How it works
          </span>
          <h2 className="mt-3 font-bold text-3xl tracking-tight sm:text-4xl">
            Guide it. It learns. You decide.
          </h2>
        </motion.div>

        <div className="flex flex-col">
          {steps.map((step, i) => (
            <Step key={step.num} {...step} delay={i * 0.1} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── The Edge ──────────────────────────────────── */

function TheEdge(): ReactElement {
  return (
    <section className="w-full border-border/40 border-t bg-background py-20 md:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
              Why community intelligence
            </span>
            <h2 className="mt-3 font-bold text-3xl tracking-tight sm:text-4xl">
              One person can&apos;t watch everything.
            </h2>
            <div className="mt-6 space-y-4 text-muted-foreground leading-relaxed">
              <p>
                There are thousands of prediction markets across dozens of
                categories. No single person can monitor them all, read every
                source, and react in time.
              </p>
              <p>
                But a community can. Members contribute watchlists, domain
                expertise, and approval criteria. The AI synthesizes it all into
                continuous, tireless research.
              </p>
              <p className="font-medium text-foreground">
                You teach it what matters. It never stops looking.
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: 0.15 }}
            className="flex flex-col gap-4"
          >
            <div className="rounded-lg border border-border/60 p-6">
              <div className="mb-3 flex items-center gap-2">
                <TrendingDown className="size-4 text-down" />
                <span className="font-mono text-down text-xs uppercase tracking-widest">
                  On your own
                </span>
              </div>
              <div className="space-y-2 font-mono text-muted-foreground text-sm">
                <p>Browse Twitter for takes</p>
                <p>Check 3 markets manually</p>
                <p>Miss the weather contract that moved 20%</p>
                <p>See the opportunity 6 hours later</p>
                <p className="text-down">Edge gone.</p>
              </div>
            </div>

            <div className="rounded-lg border border-up/30 p-6">
              <div className="mb-3 flex items-center gap-2">
                <TrendingUp className="size-4 text-up" />
                <span className="font-mono text-up text-xs uppercase tracking-widest">
                  With the bot
                </span>
              </div>
              <div className="space-y-2 font-mono text-muted-foreground text-sm">
                <p>Bot scans 2,800+ contracts 24/7</p>
                <p>Flags weather contract — criteria match</p>
                <p>Sends signal: 38c, thesis, confidence 78%</p>
                <p>You approve in one tap</p>
                <p className="text-up">Positioned in seconds.</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ─── Principles ────────────────────────────────── */

interface ValueCardProps {
  icon: ReactNode;
  title: string;
  desc: string;
  delay: number;
}

function ValueCard({ icon, title, desc, delay }: ValueCardProps): ReactElement {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay }}
      className="rounded-lg border border-border/40 bg-background p-6"
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-full border border-border/60 bg-secondary">
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <h3 className="mb-2 font-semibold text-foreground">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
    </motion.div>
  );
}

function Principles(): ReactElement {
  const values: Omit<ValueCardProps, "delay">[] = [
    {
      icon: <Eye className="size-4" />,
      title: "Fully transparent.",
      desc: "Every signal, every reasoning chain, every outcome — visible to the community. No black boxes, no hidden agendas.",
    },
    {
      icon: <Scale className="size-4" />,
      title: "Human in the loop.",
      desc: "The bot recommends. You decide. Set auto-approve thresholds or review every signal manually. Your rules, your comfort level.",
    },
    {
      icon: <BrainCircuit className="size-4" />,
      title: "Community-trained.",
      desc: "The bot evolves with the collective. Every watchlist, every approval, every skip makes it smarter for everyone.",
    },
  ];

  return (
    <section
      id="principles"
      className="w-full border-border/40 border-t bg-background py-20 md:py-28"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mb-12"
        >
          <span className="font-mono text-primary text-xs uppercase tracking-widest">
            Our principles
          </span>
          <h2 className="mt-3 font-bold text-3xl tracking-tight sm:text-4xl">
            Low key. High signal.
          </h2>
          <p className="mt-3 max-w-lg text-muted-foreground">
            No hype. No promises. Just a growing intelligence that gets better
            the more people use it.
          </p>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {values.map((v, i) => (
            <ValueCard key={v.title} {...v} delay={i * 0.1} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Bottom CTA ────────────────────────────────── */

function BottomCta(): ReactElement {
  return (
    <section className="relative w-full overflow-hidden border-border/40 border-t bg-background py-24 md:py-32">
      <div className="relative z-10 mx-auto max-w-2xl px-4 text-center sm:px-6">
        <h2 className="font-bold text-3xl tracking-tight sm:text-4xl">
          Ready to build a smarter bot?
        </h2>
        <p className="mt-4 text-muted-foreground">
          Join the community. Teach it what to watch. Let it research while you
          sleep. Approve what you like.
        </p>
        <div className="mt-8">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
          >
            Join the community
            <ArrowRight className="ml-1 size-4" />
          </button>
        </div>
        <p className="mt-6 text-muted-foreground/60 text-xs uppercase tracking-widest">
          Community-built. Transparent. Always evolving.
        </p>
      </div>
    </section>
  );
}

/* ─── Composed Export ───────────────────────────── */

export function Content(): ReactElement {
  return (
    <>
      <HowItWorks />
      <MarketCards />
      <TheEdge />
      <BrainFeed />
      <Principles />
      <BottomCta />
    </>
  );
}
