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
        <div className="relative z-20 mx-auto flex max-w-4xl flex-col items-center px-6 text-center">
          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="font-bold text-5xl tracking-tight sm:text-7xl lg:text-8xl"
          >
            <span className="text-foreground">Cogni.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.45 }}
            className="mt-4 font-medium text-2xl text-muted-foreground sm:text-3xl"
          >
            Build together.
          </motion.p>

          {/* CTA row */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
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
