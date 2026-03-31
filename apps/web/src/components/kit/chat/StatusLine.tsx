// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/chat/StatusLine`
 * Purpose: Dumb text renderer for agent activity status. Backend owns the display text.
 * Scope: Presentational only. Renders text with enter/exit animation.
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
        key="status"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className="flex w-full items-center gap-2.5 py-2"
      >
        <span className="relative flex size-2.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
        </span>
        <motion.span
          key={display}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.1 }}
          className="truncate text-foreground/70 text-sm italic"
        >
          {display}
        </motion.span>
      </motion.div>
    </AnimatePresence>
  );
};
