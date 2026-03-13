// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/chat/ComposerVoiceInput`
 * Purpose: Provides voice-to-text dictation toggle button for the chat composer.
 * Scope: Wraps assistant-ui ComposerPrimitive.Dictate and StopDictation with semantic styling.
 *   Does not implement speech recognition logic (delegates to assistant-ui runtime + DictationAdapter).
 * Invariants: PROGRESSIVE_ENHANCEMENT — renders nothing when no DictationAdapter is configured.
 *   KIT_BOUNDARY — no feature/port/core imports. VENDOR_PRISTINE — no vendor edits.
 * Side-effects: none (pure layout composition)
 * Notes: Uses Mic/MicOff icons from lucide-react. Follows ComposerAddAttachment pattern.
 * Links: Wraps @assistant-ui/react ComposerPrimitive.Dictate / StopDictation
 * @public
 */

"use client";

import { ComposerPrimitive } from "@assistant-ui/react";
import { MicIcon, MicOffIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/vendor/assistant-ui/tooltip-icon-button";

/**
 * Voice-to-text toggle button for the chat composer.
 *
 * Renders a Mic button when dictation is available and idle,
 * switches to MicOff button while dictation is active.
 * Renders nothing when no DictationAdapter is configured (progressive enhancement).
 */
export function ComposerVoiceInput() {
  return (
    <>
      <ComposerPrimitive.Dictate asChild>
        <TooltipIconButton
          tooltip="Start voice input"
          side="bottom"
          size="icon"
          // eslint-disable-next-line ui-governance/no-arbitrary-non-token-values -- Matches vendor composer button size
          className="size-[34px] rounded-full border-none bg-transparent p-1 text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground dark:hover:bg-accent"
          aria-label="Start voice input"
        >
          {/* eslint-disable-next-line ui-governance/no-arbitrary-non-token-values -- Matches vendor icon stroke */}
          <MicIcon className="size-5 stroke-[1.5px]" />
        </TooltipIconButton>
      </ComposerPrimitive.Dictate>

      <ComposerPrimitive.StopDictation asChild>
        <TooltipIconButton
          tooltip="Stop voice input"
          side="bottom"
          size="icon"
          // eslint-disable-next-line ui-governance/no-arbitrary-non-token-values -- Matches vendor composer button size
          className="size-[34px] rounded-full border-none bg-transparent p-1 text-destructive shadow-none transition-colors hover:bg-accent hover:text-destructive dark:hover:bg-accent"
          aria-label="Stop voice input"
        >
          {/* eslint-disable-next-line ui-governance/no-arbitrary-non-token-values -- Matches vendor icon stroke */}
          <MicOffIcon className="size-5 stroke-[1.5px]" />
        </TooltipIconButton>
      </ComposerPrimitive.StopDictation>
    </>
  );
}
