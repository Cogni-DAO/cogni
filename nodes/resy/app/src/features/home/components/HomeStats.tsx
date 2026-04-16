// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

"use client";

import { motion, useInView } from "framer-motion";
import {
  ArrowRight,
  Bell,
  Clock,
  Eye,
  Mail,
  Shield,
  Utensils,
  Zap,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useRef } from "react";

import { Button } from "@/components";

import { useTryDemo } from "../hooks/useTryDemo";

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
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-secondary">
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="w-px flex-1 bg-border/40" />
      </div>

      {/* Content */}
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
      title: "Connect Gmail",
      desc: "Link your Gmail account so we can listen for official Resy Notify emails the instant they arrive.",
      icon: <Mail className="size-4" />,
    },
    {
      num: "02",
      title: "Connect Resy",
      desc: "One-time browser login on Resy\u2019s site. We store your encrypted session \u2014 never your password.",
      icon: <Utensils className="size-4" />,
    },
    {
      num: "03",
      title: "Create a Watch",
      desc: "Tell us the restaurant, dates, time window, and party size. Enable auto-claim and we handle the rest.",
      icon: <Eye className="size-4" />,
    },
    {
      num: "04",
      title: "We Claim in Seconds",
      desc: "When a matching table opens, we react instantly through Resy\u2019s official booking flow. You get notified immediately.",
      icon: <Zap className="size-4" />,
    },
  ];

  return (
    <section className="w-full border-border/40 border-t bg-background py-20 md:py-28">
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
            Four steps. Then autopilot.
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

/* ─── The Problem ───────────────────────────────── */

function TheProblem(): ReactElement {
  return (
    <section className="w-full bg-background py-20 md:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Left — the problem */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <span className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
              The problem
            </span>
            <h2 className="mt-3 font-bold text-3xl tracking-tight sm:text-4xl">
              Bots eat first.
            </h2>
            <div className="mt-6 space-y-4 text-muted-foreground leading-relaxed">
              <p>
                Scalper bots snap up every desirable reservation the moment it
                opens — then resell your table at 2-10x markup.
              </p>
              <p>
                By the time your Resy notification buzzes and you tap through,
                the table is gone. The bots reacted in milliseconds. You reacted
                in 30 seconds.
              </p>
              <p className="font-medium text-foreground">
                The platforms don&apos;t fix this. We do.
              </p>
            </div>
          </motion.div>

          {/* Right — comparison */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: 0.15 }}
            className="flex flex-col gap-4"
          >
            {/* Without */}
            <div className="rounded-lg border border-border/60 p-6">
              <div className="mb-3 flex items-center gap-2">
                <Clock className="size-4 text-destructive" />
                <span className="font-mono text-destructive text-xs uppercase tracking-widest">
                  Without us
                </span>
              </div>
              <div className="space-y-2 font-mono text-muted-foreground text-sm">
                <p>
                  <span className="text-muted-foreground/50">00:00.000</span>{" "}
                  Table opens
                </p>
                <p>
                  <span className="text-muted-foreground/50">00:00.120</span>{" "}
                  Bot claims it
                </p>
                <p>
                  <span className="text-muted-foreground/50">00:00.800</span>{" "}
                  Resy sends notification
                </p>
                <p>
                  <span className="text-muted-foreground/50">00:28.000</span>{" "}
                  You open your phone
                </p>
                <p>
                  <span className="text-muted-foreground/50">00:34.000</span>{" "}
                  <span className="text-destructive">Gone.</span>
                </p>
              </div>
            </div>

            {/* With */}
            <div className="rounded-lg border border-primary/30 p-6">
              <div className="mb-3 flex items-center gap-2">
                <Zap className="size-4 text-primary" />
                <span className="font-mono text-primary text-xs uppercase tracking-widest">
                  With us
                </span>
              </div>
              <div className="space-y-2 font-mono text-muted-foreground text-sm">
                <p>
                  <span className="text-muted-foreground/50">00:00.000</span>{" "}
                  Resy sends Notify email
                </p>
                <p>
                  <span className="text-muted-foreground/50">00:00.400</span>{" "}
                  Gmail push received
                </p>
                <p>
                  <span className="text-muted-foreground/50">00:01.200</span>{" "}
                  Match confirmed — claiming
                </p>
                <p>
                  <span className="text-muted-foreground/50">00:03.800</span>{" "}
                  <span className="text-primary">
                    Reserved. You&apos;re in.
                  </span>
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ─── Values ────────────────────────────────────── */

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

function Values(): ReactElement {
  const values: Omit<ValueCardProps, "delay">[] = [
    {
      icon: <Shield className="size-4" />,
      title: "No scalping. Ever.",
      desc: "One person, one account, one table. We help you eat \u2014 not flip reservations for profit.",
    },
    {
      icon: <Bell className="size-4" />,
      title: "Official channels only",
      desc: "We use Resy\u2019s own notification system and booking flow. No scraping, no reverse engineering, no TOS violations.",
    },
    {
      icon: <Eye className="size-4" />,
      title: "Full transparency",
      desc: "Every action is logged. See exactly what we did, when, and why. Your activity log hides nothing.",
    },
  ];

  return (
    <section className="w-full border-border/40 border-t bg-background py-20 md:py-28">
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
            Built different.
          </h2>
          <p className="mt-3 max-w-lg text-muted-foreground">
            We built this because we were tired of losing tables too. The rules
            are simple.
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
  const { handleTryDemo } = useTryDemo();

  return (
    <section className="relative w-full overflow-hidden border-border/40 border-t bg-background py-24 md:py-32">
      <div className="relative z-10 mx-auto max-w-2xl px-4 text-center sm:px-6">
        <h2 className="font-bold text-3xl tracking-tight sm:text-4xl">
          Ready to stop losing tables?
        </h2>
        <p className="mt-4 text-muted-foreground">
          Connect your accounts, set your watch, and let us handle the speed
          game.
        </p>
        <div className="mt-8">
          <Button size="lg" onClick={handleTryDemo}>
            Get started
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </div>
        <p className="mt-6 text-muted-foreground/60 text-xs uppercase tracking-widest">
          No subscription. No markup. Just your table.
        </p>
      </div>
    </section>
  );
}

/* ─── Composed Export ───────────────────────────── */

export function HomeContent(): ReactElement {
  return (
    <>
      <HowItWorks />
      <TheProblem />
      <Values />
      <BottomCta />
    </>
  );
}

/**
 * @deprecated Kept for backwards compatibility — use HomeContent instead.
 */
export function HomeStats(): ReactElement {
  return <HomeContent />;
}
