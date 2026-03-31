// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/chat/StatusLine`
 * Purpose: Dumb text renderer for agent activity status. Backend owns the display text.
 * Scope: Presentational only. Renders text + pulse dot with enter/exit animation.
 * Invariants:
 *   - BACKEND_OWNS_TEXT: never generates display text from phase enum
 *   - TEXT_MAX_80: truncates at 80 characters
 *   - STATUS_IS_EPHEMERAL: transient indicator, no persistence
 * Side-effects: none
 * @public
 */

"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { FC } from "react";

interface StatusLineProps {
  /** Human-readable status text from backend. Truncated at 80 chars. */
  readonly text: string;
}

export const StatusLine: FC<StatusLineProps> = ({ text }) => {
  const display = text.length > 80 ? `${text.slice(0, 77)}...` : text;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={display}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className="mx-auto flex w-full max-w-[var(--thread-max-width)] items-center gap-2 px-4 py-1.5"
      >
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
        <span className="truncate text-muted-foreground text-sm">
          {display}
        </span>
      </motion.div>
    </AnimatePresence>
  );
};
