// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/home/components/NewHomeHero`
 * Purpose: Hero section for the homepage with 3D knowledge-tree visualization.
 * Scope: Homepage only. Does not handle global layout.
 * Invariants: None.
 * Side-effects: none
 * Links: src/features/home/components/KnowledgeTrees.tsx, src/features/home/hooks/useTryDemo.ts
 */

"use client";

import { motion } from "framer-motion";
import { ArrowRight, Github } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";

import { Button } from "@/components";

import { useTryDemo } from "../hooks/useTryDemo";

import { KnowledgeTreesBackground } from "./KnowledgeTrees";

export function NewHomeHero(): ReactElement {
  const { handleTryDemo } = useTryDemo();

  return (
    <>
      {/* eslint-disable-next-line ui-governance/no-arbitrary-non-token-values */}
      <section className="relative flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-hidden bg-background">
        {/* 3D Knowledge Trees Background */}
        <KnowledgeTreesBackground />

        {/* Atmospheric gradient overlays */}
        {/* eslint-disable-next-line ui-governance/no-arbitrary-non-token-values */}
        <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,119,198,0.12),transparent)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-32 bg-gradient-to-t from-background to-transparent" />

        {/* Content */}
        <div className="relative z-20 mx-auto flex max-w-5xl flex-col items-center px-6 text-center">
          {/* Status pill */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-border/40 bg-background/50 px-4 py-1.5 backdrop-blur-md"
          >
            {/* eslint-disable-next-line ui-governance/no-raw-colors */}
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400" />
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-widest">
              Open Source &middot; Community Governed
            </span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
            className="font-bold text-4xl tracking-tight sm:text-6xl lg:text-7xl"
          >
            <span className="text-foreground">Build </span>
            <span className="text-gradient-accent">community-owned</span>
            <br className="hidden sm:block" />
            <span className="text-foreground"> AI apps.</span>
          </motion.h1>

          {/* Subline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.55 }}
            className="mx-auto mt-6 max-w-xl text-base text-muted-foreground sm:text-lg"
          >
            A starter kit for autonomous, DAO-governed AI organizations.
            <br className="hidden sm:block" />
            Web3 governance. Web2 intelligence. One codebase.
          </motion.p>

          {/* CTA row */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.75 }}
            className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4"
          >
            <Button size="lg" onClick={handleTryDemo}>
              Try the demo
              <ArrowRight className="ml-2 size-4" />
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="https://github.com/cogni-dao/cogni-template">
                <Github className="mr-2 size-4" />
                Start your own
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link
                href="https://discord.gg/3b9sSyhZ4z"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg
                  viewBox="0 0 127.14 96.36"
                  fill="currentColor"
                  className="mr-2 size-4"
                  aria-hidden="true"
                >
                  <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
                </svg>
                Join the Chat
              </Link>
            </Button>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 0.8 }}
          className="absolute bottom-8 z-20 flex flex-col items-center gap-2"
        >
          <span className="text-muted-foreground/50 text-xs uppercase tracking-widest">
            Scroll
          </span>
          <div className="h-8 w-px animate-pulse bg-gradient-to-b from-muted-foreground/30 to-transparent" />
        </motion.div>
      </section>
    </>
  );
}
