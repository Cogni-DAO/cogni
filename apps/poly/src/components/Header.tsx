"use client";

import { motion } from "framer-motion";
import { Activity, Github } from "lucide-react";
import type { ReactElement } from "react";

export function Header(): ReactElement {
  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed top-0 z-50 flex w-full items-center justify-between border-border/40 border-b bg-background/80 px-6 py-4 backdrop-blur-md"
    >
      <div className="flex items-center gap-2">
        <Activity className="size-5 text-primary" />
        <span className="font-semibold text-foreground tracking-tight">
          cogni<span className="text-primary">/poly</span>
        </span>
      </div>

      <nav className="hidden items-center gap-6 sm:flex">
        <a
          href="#how-it-works"
          className="text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          How it works
        </a>
        <a
          href="#markets"
          className="text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          Markets
        </a>
        <a
          href="#principles"
          className="text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          Principles
        </a>
      </nav>

      <div className="flex items-center gap-3">
        <a
          href="https://github.com/cogni-dao"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Github className="size-4" />
        </a>
        <button
          type="button"
          className="rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 font-medium text-primary text-sm transition-colors hover:bg-primary/20"
        >
          Join waitlist
        </button>
      </div>
    </motion.header>
  );
}
