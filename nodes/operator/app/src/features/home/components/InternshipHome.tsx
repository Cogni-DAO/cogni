// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/components/InternshipHome`
 * Purpose: Public internship recruitment homepage and interest signup flow.
 * Scope: Renders the operator landing surface and posts interest events to the public API.
 * Invariants: Form shape derives from the contract; UI stays unauthenticated and mobile-first.
 * Side-effects: IO (interest form POST), browser state
 * Links: story.5001, contracts/internship.interest.v1.contract.ts
 * @public
 */

"use client";

import { cn } from "@cogni/node-ui-kit/util/cn";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Blocks,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Github,
  GitPullRequest,
  Network,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { type CSSProperties, type ReactElement, useState } from "react";
import { Button, Input } from "@/components";
import type { InternshipInterestInput } from "@/contracts/internship.interest.v1.contract";
import { InternshipNetworkBackground } from "./InternshipNetworkBackground";

type FormState = InternshipInterestInput & {
  github: string;
  note: string;
};

const focusOptions: {
  value: InternshipInterestInput["focus"];
  label: string;
}[] = [
  { value: "x402-apps", label: "Specialized x402 agent" },
  { value: "attribution-scoring", label: "Attribution + DAO distributions" },
  { value: "node-infrastructure", label: "Node infrastructure" },
  { value: "dao-operations", label: "DAO operations" },
  { value: "research-product", label: "Research + product" },
  { value: "undecided", label: "Undecided" },
];

const squadOptions: {
  value: InternshipInterestInput["squadStatus"];
  label: string;
}[] = [
  { value: "solo", label: "Solo for now" },
  { value: "forming", label: "Forming a squad" },
  { value: "squad-ready", label: "Squad ready" },
];

const tracks = [
  {
    title: "Start with an idea",
    body: "Pick a real domain problem worth serving with an AI agent, then turn it into a node-shaped product.",
    icon: Network,
  },
  {
    title: "Find a squad",
    body: "Join or form a focused team, choose clear ownership, and keep the work small enough to ship quickly.",
    icon: UsersRound,
  },
  {
    title: "Grow the knowledge base",
    body: "Capture decisions, evidence, prompts, evals, and contribution signals so the node gets smarter over time.",
    icon: BrainCircuit,
  },
  {
    title: "Ship the agent",
    body: "Launch a specialized AI agent with x402 request settlement and multi-tenant access built in from the start.",
    icon: Bot,
  },
];

const roadmap = [
  "Recruit quickly in May",
  "Start from one concrete AI business idea",
  "Form squads around domain and infrastructure ownership",
  "Grow the node knowledge base as the team works",
  "Ship a specialized x402 agent with multi-tenant access",
  "Validate the live request and read it back from Loki",
];

const signupPromises = [
  { icon: UsersRound, text: "Start solo or join a focused squad" },
  { icon: ShieldCheck, text: "Build for multi-tenant access from day one" },
  { icon: GitPullRequest, text: "Ship through PR, flight, and candidate-a" },
];

const initialForm: FormState = {
  name: "",
  email: "",
  github: "",
  focus: "x402-apps",
  squadStatus: "solo",
  note: "",
};

const internshipLightThemeStyle = {
  "--background": "43 33% 96%",
  "--foreground": "150 14% 10%",
  "--card": "43 40% 98%",
  "--card-foreground": "150 14% 10%",
  "--popover": "43 40% 98%",
  "--popover-foreground": "150 14% 10%",
  "--primary": "161 38% 31%",
  "--primary-foreground": "43 33% 96%",
  "--secondary": "42 28% 89%",
  "--secondary-foreground": "150 14% 16%",
  "--muted": "42 25% 91%",
  "--muted-foreground": "215 12% 37%",
  "--accent": "161 20% 86%",
  "--accent-foreground": "150 14% 14%",
  "--border": "42 18% 75%",
  "--input": "42 18% 75%",
  "--ring": "161 38% 31%",
} as CSSProperties;

function fadeProps(index = 0) {
  return {
    initial: { opacity: 0, y: 18 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-60px" },
    transition: { duration: 0.45, delay: index * 0.08 },
  };
}

function StatusStrip(): ReactElement {
  return (
    <div className="inline-flex flex-wrap items-center justify-center gap-3 rounded-full border border-border/70 bg-background/80 px-4 py-2 shadow-sm backdrop-blur">
      <span className="inline-flex items-center gap-2 font-mono text-muted-foreground text-xs uppercase tracking-widest">
        <span className="size-2 rounded-full bg-foreground/50" />
        May sprint
      </span>
      <span className="hidden h-4 w-px bg-border sm:block" />
      <span className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
        Ideas + squads + x402 agents
      </span>
    </div>
  );
}

function HeroSection(): ReactElement {
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative flex min-h-dvh w-full items-center overflow-hidden bg-muted px-4 pt-24 pb-16 sm:px-6">
      {!reduceMotion && <InternshipNetworkBackground />}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-muted" />

      <div className="relative z-10 mx-auto max-w-5xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <StatusStrip />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1 }}
          className="mx-auto mt-8 max-w-4xl font-bold text-4xl text-foreground tracking-tight sm:text-6xl lg:text-7xl"
        >
          Start with an idea.
          <br />
          <span className="text-foreground">Grow it into an AI business.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.2 }}
          className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground leading-relaxed sm:text-xl"
        >
          Cogni is opening an internship track for builders who want to find a
          squad, grow an AI knowledge base, and ship specialized agents with
          x402 settlement and multi-tenant access.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.3 }}
          className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
        >
          <Button asChild size="lg">
            <a href="#interest">
              Apply interest
              <ArrowRight className="ml-2 size-4" />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="https://github.com/cogni-dao/cogni-template">
              <Github className="mr-2 size-4" />
              Read the repo
            </Link>
          </Button>
        </motion.div>
      </div>
    </section>
  );
}

function TrackSection(): ReactElement {
  return (
    <section className="w-full bg-muted py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div {...fadeProps()} className="mb-12 max-w-2xl">
          <span className="font-mono text-foreground text-xs uppercase tracking-widest">
            Internship shape
          </span>
          <h2 className="mt-3 font-bold text-3xl text-foreground tracking-tight sm:text-4xl">
            Build from a real idea into a real node.
          </h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            The work starts with a concrete AI business idea, then becomes a
            squad, a knowledge base, and a specialized agent that can serve
            multiple tenants through the Cogni node model.
          </p>
        </motion.div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tracks.map((track, index) => (
            <motion.div
              key={track.title}
              {...fadeProps(index)}
              className="rounded-lg border border-border/70 bg-card/80 p-6 shadow-sm backdrop-blur"
            >
              <div className="mb-5 flex size-11 items-center justify-center rounded-md border border-border bg-secondary/60 text-foreground">
                <track.icon className="size-5" />
              </div>
              <h3 className="font-semibold text-foreground text-xl">
                {track.title}
              </h3>
              <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
                {track.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function X402Section(): ReactElement {
  return (
    <section className="w-full border-border/70 border-y bg-background py-20 md:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
        <motion.div {...fadeProps()}>
          <span className="font-mono text-foreground text-xs uppercase tracking-widest">
            New-age AI business
          </span>
          <h2 className="mt-3 font-bold text-3xl text-foreground tracking-tight sm:text-4xl">
            A specialized agent, not a generic chatbot.
          </h2>
          <p className="mt-5 text-muted-foreground leading-relaxed">
            The target shape is simple: a tenant calls a specialized AI agent,
            the node runs the workflow against its knowledge base, x402 settles
            the request, and the DAO has clean evidence for scoring and
            distributions.
          </p>
        </motion.div>

        <motion.div
          {...fadeProps(1)}
          className="rounded-lg border border-border/70 bg-card/80 p-5 shadow-sm"
        >
          <div className="mb-5 flex items-center gap-3">
            <Blocks className="size-5 text-foreground" />
            <span className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
              Request path
            </span>
          </div>
          <div className="space-y-3">
            {[
              ["Tenant", "Requests specialized work"],
              ["Agent", "Uses the node knowledge base"],
              ["x402", "Settles the request"],
              ["DAO", "Scores contribution evidence"],
            ].map(([label, body]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 rounded-md border border-border/70 bg-background px-4 py-3"
              >
                <span className="font-mono text-foreground text-xs uppercase tracking-widest">
                  {label}
                </span>
                <span className="text-muted-foreground text-sm">{body}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function RoadmapSection(): ReactElement {
  return (
    <section className="w-full bg-muted py-20 md:py-28">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <motion.div {...fadeProps()}>
          <span className="font-mono text-foreground text-xs uppercase tracking-widest">
            Pareto plan
          </span>
          <h2 className="mt-3 font-bold text-3xl text-foreground tracking-tight sm:text-4xl">
            Move fast, but keep the proof loop real.
          </h2>
          <p className="mt-5 text-muted-foreground leading-relaxed">
            Derek will drive social recruitment. The operator domain should keep
            the canonical project, intake, and validation evidence so the
            program compounds instead of becoming a loose chat thread.
          </p>
        </motion.div>

        <div className="space-y-4">
          {roadmap.map((item, index) => (
            <motion.div
              key={item}
              {...fadeProps(index)}
              className="flex gap-4 rounded-lg border border-border/70 bg-card/80 p-4 shadow-sm"
            >
              <CheckCircle2 className="mt-1 size-5 shrink-0 text-foreground" />
              <div>
                <span className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
                  0{index + 1}
                </span>
                <p className="mt-1 font-medium text-foreground">{item}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SignupForm(): ReactElement {
  const [form, setForm] = useState<FormState>(initialForm);
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [referenceId, setReferenceId] = useState<string | null>(null);

  const update =
    (key: keyof FormState) =>
    (
      event:
        | React.ChangeEvent<HTMLInputElement>
        | React.ChangeEvent<HTMLSelectElement>
        | React.ChangeEvent<HTMLTextAreaElement>
    ): void => {
      setForm((current) => ({ ...current, [key]: event.target.value }));
    };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setReferenceId(null);

    const payload: InternshipInterestInput = {
      name: form.name,
      email: form.email,
      focus: form.focus,
      squadStatus: form.squadStatus,
      ...(form.github.trim() && { github: form.github.trim() }),
      ...(form.note.trim() && { note: form.note.trim() }),
    };

    const response = await fetch("/api/v1/public/internship-interest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      setStatus("error");
      return;
    }

    const data = (await response.json()) as { referenceId: string };
    setReferenceId(data.referenceId);
    setStatus("success");
    setForm(initialForm);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2" htmlFor="intern-name">
          <span className="font-medium text-foreground text-sm">Name</span>
          <Input
            id="intern-name"
            required
            value={form.name}
            onChange={update("name")}
            autoComplete="name"
            className="border-input bg-background text-foreground"
          />
        </label>
        <label className="space-y-2" htmlFor="intern-email">
          <span className="font-medium text-foreground text-sm">Email</span>
          <Input
            id="intern-email"
            type="email"
            required
            value={form.email}
            onChange={update("email")}
            autoComplete="email"
            className="border-input bg-background text-foreground"
          />
        </label>
      </div>

      <label className="space-y-2" htmlFor="intern-github">
        <span className="font-medium text-foreground text-sm">
          GitHub or portfolio
        </span>
        <Input
          id="intern-github"
          value={form.github}
          onChange={update("github")}
          autoComplete="url"
          className="border-input bg-background text-foreground"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2" htmlFor="intern-focus">
          <span className="font-medium text-foreground text-sm">Focus</span>
          <select
            id="intern-focus"
            value={form.focus}
            onChange={update("focus")}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {focusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2" htmlFor="intern-squad">
          <span className="font-medium text-foreground text-sm">
            Squad status
          </span>
          <select
            id="intern-squad"
            value={form.squadStatus}
            onChange={update("squadStatus")}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {squadOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="space-y-2" htmlFor="intern-note">
        <span className="font-medium text-foreground text-sm">
          What would you build?
        </span>
        <textarea
          id="intern-note"
          value={form.note}
          onChange={update("note")}
          rows={5}
          className="flex min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" disabled={status === "submitting"} size="lg">
          {status === "submitting" ? "Submitting" : "Submit interest"}
          <ArrowRight className="ml-2 size-4" />
        </Button>
        <Link
          href="https://discord.gg/3b9sSyhZ4z"
          className="inline-flex items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          Join Discord
          <ArrowRight className="size-4" />
        </Link>
      </div>

      <p
        aria-live="polite"
        className={cn(
          "min-h-6 text-sm",
          status === "error" ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {status === "success" && referenceId
          ? `Interest received. Reference ${referenceId}.`
          : status === "error"
            ? "Submission failed. Check the fields and try again."
            : "Submitting records an operator event; Discord is the fastest follow-up path."}
      </p>
    </form>
  );
}

function SignupSection(): ReactElement {
  return (
    <section
      id="interest"
      className="w-full border-border/70 border-t bg-background py-20 md:py-28"
    >
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <motion.div {...fadeProps()}>
          <span className="font-mono text-foreground text-xs uppercase tracking-widest">
            Interest signup
          </span>
          <h2 className="mt-3 font-bold text-3xl text-foreground tracking-tight sm:text-4xl">
            Bring a squad, or find one here.
          </h2>
          <p className="mt-5 text-muted-foreground leading-relaxed">
            This is intentionally early. The legal wrapper is still being
            formed, but the build path is concrete enough: start from an idea,
            form a node squad, grow the knowledge base, and ship the agent.
          </p>
          <div className="mt-8 grid gap-3">
            {signupPromises.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <Icon className="size-5 text-foreground" />
                <span className="text-foreground text-sm">{text}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          {...fadeProps(1)}
          className="rounded-lg border border-border/70 bg-card/80 p-5 shadow-sm sm:p-6"
        >
          <SignupForm />
        </motion.div>
      </div>
    </section>
  );
}

export function InternshipHome(): ReactElement {
  const { resolvedTheme } = useTheme();
  const themeStyle =
    resolvedTheme === "light" ? internshipLightThemeStyle : undefined;

  return (
    <main
      className="flex min-h-screen flex-col bg-muted text-foreground"
      style={themeStyle}
    >
      <HeroSection />
      <TrackSection />
      <X402Section />
      <RoadmapSection />
      <SignupSection />
    </main>
  );
}
