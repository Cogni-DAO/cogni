// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/ai/components/ModelPicker`
 * Purpose: Provides model selection dialog for chat interface.
 * Scope: Feature-specific controlled UI component for selecting AI models. Does not manage state, persistence, or API data (delegates to parent).
 * Invariants: Responsive CSS (mobile bottom-sheet, desktop centered modal).
 * Side-effects: none (controlled component, delegates state to parent)
 * Notes: Uses Dialog+ScrollArea from shadcn, provider icons from config.
 * Links: Used by ChatComposerExtras, provider-icons config
 * @internal
 */

"use client";

import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/kit/overlays/Dialog";
import type { Model } from "@/contracts/ai.models.v1.contract";
import {
  getIconByProviderKey,
  getProviderIcon,
} from "@/features/ai/config/provider-icons";
import { OpenAIIcon } from "@/features/ai/icons/providers/OpenAIIcon";
import { cn } from "@/shared/util/cn";

export type LlmBackend = "openrouter" | "chatgpt";

export interface ModelPickerProps {
  models: Model[];
  value: string;
  onValueChange: (modelId: string) => void;
  disabled?: boolean;
  balance?: number;
  /** Current LLM backend provider */
  backend: LlmBackend;
  /** Called when user toggles between OpenRouter and ChatGPT */
  onBackendChange: (backend: LlmBackend) => void;
  /** Whether user has a linked ChatGPT connection */
  hasChatGptConnection: boolean;
}

export function ModelPicker({
  models,
  value,
  onValueChange,
  disabled,
  balance = 0,
  backend,
  onBackendChange,
  hasChatGptConnection,
}: Readonly<ModelPickerProps>) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedModel = models.find((m) => m.id === value);
  const filteredModels = models.filter((model) => {
    const query = searchQuery.toLowerCase();
    return (
      model.id.toLowerCase().includes(query) ||
      model.name?.toLowerCase().includes(query)
    );
  });

  // Format model name for display
  const displayName =
    backend === "chatgpt"
      ? "ChatGPT"
      : selectedModel?.name || selectedModel?.id || "Select model";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            // Base styles - rounded-full like attachment button, proper sizing
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5",
            "h-[var(--size-composer-icon-btn)] w-auto",
            "border-none bg-transparent shadow-none outline-none",
            // Typography - match attachment button
            "font-semibold text-muted-foreground text-xs",
            // Hover - use semantic accent tokens (matches card hover)
            "transition-colors hover:bg-accent hover:text-foreground",
            // Active/expanded state
            "aria-[expanded=true]:bg-accent aria-[expanded=true]:text-foreground",
            // Disabled state
            "disabled:pointer-events-none disabled:opacity-50"
          )}
          aria-label="Select model"
        >
          <span className="max-w-[var(--max-width-model-trigger)] truncate">
            {displayName}
          </span>
          <ChevronDown className="size-4 shrink-0" />
        </button>
      </DialogTrigger>

      <DialogContent
        className={cn(
          // Mobile: centered card with margins
          "fixed inset-3 top-auto w-auto max-w-none translate-x-0 translate-y-0 rounded-2xl",
          "max-h-[var(--max-height-dialog-mobile)]",
          // Desktop: centered modal
          "sm:inset-auto sm:top-[var(--center-50)] sm:left-[var(--center-50)] sm:w-full",
          "sm:translate-x-[var(--center-neg-50)] sm:translate-y-[var(--center-neg-50)]",
          "sm:max-h-[var(--max-height-dialog)] sm:max-w-lg sm:rounded-2xl",
          // Shared — override base grid with flex
          "flex flex-col gap-4"
        )}
      >
        <DialogHeader>
          <DialogTitle>Select Model</DialogTitle>
        </DialogHeader>

        {/* Provider toggle — OpenRouter vs ChatGPT */}
        {hasChatGptConnection && (
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => onBackendChange("openrouter")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 font-medium text-sm transition-colors",
                backend === "openrouter"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
              OpenRouter
            </button>
            <button
              type="button"
              onClick={() => onBackendChange("chatgpt")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 font-medium text-sm transition-colors",
                backend === "chatgpt"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <OpenAIIcon className="size-4" />
              ChatGPT
            </button>
          </div>
        )}

        {backend === "chatgpt" ? (
          /* ChatGPT backend — single entry, no model selection needed */
          <div className="-mx-6 px-6">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-md bg-accent px-3 py-3 text-left"
            >
              <OpenAIIcon className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">
                  ChatGPT (Your Subscription)
                </div>
                <div className="text-muted-foreground text-xs">
                  Uses your linked ChatGPT account — $0 platform cost
                </div>
              </div>
              <Check className="size-4 shrink-0 text-primary" />
            </button>
          </div>
        ) : (
          /* OpenRouter backend — full model list */
          <>
            {/* Search input */}
            <input
              type="text"
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-offset-background"
            />

            {/* Models list */}
            <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
              <div className="space-y-1">
                {filteredModels.length === 0 ? (
                  <div className="py-6 text-center text-muted-foreground text-sm">
                    No models found
                  </div>
                ) : (
                  filteredModels.map((model) => {
                    const Icon = model.providerKey
                      ? getIconByProviderKey(model.providerKey)
                      : getProviderIcon(model.id);
                    const isSelected = model.id === value;
                    const isPaidAndNoBalance = !model.isFree && balance <= 0;

                    return (
                      <button
                        key={model.id}
                        type="button"
                        disabled={isPaidAndNoBalance}
                        onClick={() => {
                          if (!isPaidAndNoBalance) {
                            onValueChange(model.id);
                            setOpen(false);
                            setSearchQuery("");
                          }
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left",
                          "transition-colors hover:bg-accent",
                          isSelected && "bg-accent",
                          isPaidAndNoBalance &&
                            "cursor-not-allowed opacity-50 hover:bg-transparent"
                        )}
                      >
                        <Icon className="size-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1 truncate font-medium text-sm">
                          {model.name || model.id}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {model.isZdr && (
                            <span className="flex items-center gap-1 font-medium text-primary text-xs">
                              <ShieldCheck className="size-3" />
                              Private (ZDR)
                            </span>
                          )}
                          {model.isFree && (
                            <span className="flex items-center gap-1.5 font-medium text-sm text-success">
                              {isSelected && <Check className="size-4" />}
                              Free
                            </span>
                          )}
                          {!model.isFree && !model.isZdr && isSelected && (
                            <Check className="size-4 text-primary" />
                          )}
                          {model.isZdr && isSelected && (
                            <Check className="size-4 text-primary" />
                          )}
                          {isPaidAndNoBalance && (
                            <span className="text-muted-foreground text-xs">
                              (Credits required)
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
