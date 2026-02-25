// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/chat/page`
 * Purpose: Chat page with thread history sidebar and assistant-ui Thread.
 * Scope: Client component that renders thread sidebar (desktop aside + mobile Sheet), thread switching state, model/graph selection, and ChatRuntimeProvider with key-based remount. Does not handle authentication directly.
 * Invariants:
 *   - INV-UI-NO-PAID-DEFAULT-WHEN-ZERO: gates rendering until models + credits resolve
 *   - INV-NO-CLIENT-INVENTED-MODEL-IDS: all model IDs from server's models list
 *   - KEY_REMOUNT: `key={activeThreadKey ?? "new"}` forces full unmount/remount on thread switch, aborting in-flight streams
 *   - LOADING_GATE: `isThreadLoading` prevents ChatRuntimeProvider render until thread messages load
 * Side-effects: IO (chat API, thread list/load/delete via React Query)
 * Notes: Thread sidebar shared between desktop (aside) and mobile (Sheet). Thread finish invalidates ai-threads query.
 * Links: src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx, src/features/ai/chat/hooks/useThreads.ts
 * @public
 */

"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { Menu, PanelLeft, PanelLeftClose, Plus, Trash2 } from "lucide-react";
import { signOut } from "next-auth/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Button,
  ErrorAlert,
  Sheet,
  SheetContent,
  SheetTitle,
  Thread,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components";
import type { ChatError } from "@/contracts/error.chat.v1.contract";
import { ChatRuntimeProvider } from "@/features/ai/chat/providers/ChatRuntimeProvider.client";
import { toErrorAlertProps } from "@/features/ai/chat/utils/toErrorAlertProps";
import {
  ChatComposerExtras,
  ChatErrorBubble,
  DEFAULT_GRAPH_ID,
  getPreferredModelId,
  pickDefaultModel,
  setPreferredModelId,
  useDeleteThread,
  useLoadThread,
  useModels,
  useThreads,
} from "@/features/ai/public";
import { useCreditsSummary } from "@/features/payments/public";
import type { GraphId } from "@/ports";
import { cn } from "@/shared/util/cn";

const ChatWelcomeWithHint = () => (
  <div className="mx-auto flex h-full w-full max-w-[var(--thread-max-width)] flex-col items-center justify-center">
    <div className="flex flex-col justify-center gap-1 px-8">
      <div className="fade-in slide-in-from-bottom-2 animate-in whitespace-nowrap text-2xl text-muted-foreground/65 duration-300 ease-out">
        Clone this living mind 🧠
      </div>
      <div className="fade-in slide-in-from-bottom-2 animate-in whitespace-nowrap text-2xl text-muted-foreground/65 delay-100 duration-300 ease-out">
        Teach it what your people need 🏘️
      </div>
      <div className="fade-in slide-in-from-bottom-2 animate-in whitespace-nowrap text-2xl text-muted-foreground/65 delay-200 duration-300 ease-out">
        Intelligence, shared. 🤝
      </div>
    </div>
  </div>
);

export default function ChatPage(): ReactNode {
  const modelsQuery = useModels();
  const { data: creditsData, isLoading: isCreditsLoading } =
    useCreditsSummary();
  // Display raw balance (including negative); no unsafe defaults
  const balance = creditsData?.balanceCredits ?? 0;

  // Refs for user intent tracking (prevent re-init after user selection)
  const hasUserSelectedRef = useRef(false);
  const hasInitializedRef = useRef(false);

  // State
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedGraph, setSelectedGraph] = useState(DEFAULT_GRAPH_ID);
  const [chatError, setChatError] = useState<ChatError | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);

  // Thread switching state
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);

  // Extract server-provided defaults (NO CLIENT INVENTION)
  const models = modelsQuery.data?.models ?? [];
  const defaultPreferredModelId =
    modelsQuery.data?.defaultPreferredModelId ?? null;
  const defaultFreeModelId = modelsQuery.data?.defaultFreeModelId ?? null;
  const freeModelIds = models.filter((m) => m.isFree).map((m) => m.id);

  // Single initialization effect
  useEffect(() => {
    // Skip if user already selected or already initialized
    if (hasInitializedRef.current || hasUserSelectedRef.current) {
      return;
    }
    // Wait for both data sources
    if (isCreditsLoading || !modelsQuery.data) {
      return;
    }

    const userChoice = getPreferredModelId();

    // MF-6: Feature-layer validation - if zero credits, ensure userChoice is free
    let validatedChoice = userChoice;
    if (balance <= 0 && userChoice && !freeModelIds.includes(userChoice)) {
      validatedChoice = null; // Invalidate paid model selection when out of credits
    }

    const selected = pickDefaultModel({
      balanceCredits: balance,
      userChoice: validatedChoice,
      defaultFreeModelId,
      defaultPaidModelId: defaultPreferredModelId,
    });

    if (selected) {
      setSelectedModel(selected);
      setIsBlocked(false);
    } else {
      // No valid model: blocked state (zero credits + no free models)
      setIsBlocked(true);
      setChatError({
        code: "NO_FREE_MODELS",
        message: "No free models available. Add credits to continue chatting.",
        retryable: false,
        blocking: true,
        suggestedAction: "add_credits",
      });
    }

    hasInitializedRef.current = true;
  }, [
    isCreditsLoading,
    balance,
    modelsQuery.data,
    freeModelIds,
    defaultFreeModelId,
    defaultPreferredModelId,
  ]);
  // NOTE: selectedModel intentionally NOT in deps to prevent re-init loop

  // Model change handler - marks user intent
  const handleModelChange = useCallback((modelId: string) => {
    hasUserSelectedRef.current = true;
    setSelectedModel(modelId);
    setPreferredModelId(modelId);
    setIsBlocked(false);
    setChatError(null);
  }, []);

  // Graph change handler
  const handleGraphChange = useCallback((graphId: GraphId) => {
    setSelectedGraph(graphId);
  }, []);

  // Error handler from provider
  const handleError = useCallback((error: ChatError) => {
    setChatError(error);
  }, []);

  // Switch to free model action
  const handleSwitchFreeModel = useCallback(() => {
    if (defaultFreeModelId) {
      handleModelChange(defaultFreeModelId);
    }
  }, [defaultFreeModelId, handleModelChange]);

  // Retry action - clear error (runtime handles retry internally)
  const handleRetry = useCallback(() => {
    setChatError(null);
  }, []);

  // Add credits action (navigate to credits page)
  const handleAddCredits = useCallback(() => {
    window.location.href = "/credits";
  }, []);

  // Thread data hooks
  const queryClient = useQueryClient();
  const threadsQuery = useThreads();
  const threadData = useLoadThread(activeThreadKey);
  const deleteThread = useDeleteThread();

  const handleSelectThread = useCallback((key: string) => {
    setChatError(null);
    setActiveThreadKey(key);
    setSidebarOpen(false);
  }, []);

  const handleNewThread = useCallback(() => {
    setChatError(null);
    setActiveThreadKey(null);
    setSidebarOpen(false);
  }, []);

  const handleDeleteThread = useCallback(
    (key: string) => {
      deleteThread.mutate(key);
      if (activeThreadKey === key) {
        setActiveThreadKey(null);
      }
    },
    [activeThreadKey, deleteThread]
  );

  const handleThreadFinish = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["ai-threads"] });
  }, [queryClient]);

  // Prepare error alert props
  const errorAlertProps = chatError
    ? toErrorAlertProps(chatError, !!defaultFreeModelId)
    : null;

  // INV-UI-NO-PAID-DEFAULT-WHEN-ZERO: Gate rendering until init completes
  if (!hasInitializedRef.current) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // INV-NO-INTERACTION-BEFORE-READY: Blocked state shows error only, no chat
  if (isBlocked && !selectedModel) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
        <div className="mx-auto w-full max-w-[var(--size-container-sm)] px-4">
          {errorAlertProps && (
            <ErrorAlert
              code={errorAlertProps.code}
              message={errorAlertProps.message}
              onAddCredits={handleAddCredits}
              onRetry={handleRetry}
              onSwitchFreeModel={handleSwitchFreeModel}
              retryable={errorAlertProps.retryable}
              showAddCredits={errorAlertProps.showAddCredits}
              showRetry={errorAlertProps.showRetry}
              showSwitchFree={errorAlertProps.showSwitchFree}
            />
          )}
        </div>
      </div>
    );
  }

  // Compute UI default model based on credits (NO HARDCODED FALLBACKS)
  // INV-NO-CLIENT-INVENTED-MODEL-IDS: UI must NEVER invent model IDs
  const uiDefaultModelId =
    balance <= 0 ? defaultFreeModelId : defaultPreferredModelId;

  // Invariant: selectedModel is guaranteed non-null after initialization gate
  // If this assertion fails, initialization logic has a bug
  if (!selectedModel) {
    throw new Error(
      "INV-VIOLATION: selectedModel is null after initialization gate"
    );
  }

  // Invariant: uiDefaultModelId must exist (server provides valid default)
  // If this fails, server config is broken (catalog defaults missing)
  if (!uiDefaultModelId) {
    throw new Error(
      "INV-VIOLATION: server returned no valid default model for credit state"
    );
  }

  // Gate provider render: for existing threads, wait until messages are loaded.
  // New threads (activeThreadKey === null) render immediately with no initial messages.
  const isThreadLoading = activeThreadKey != null && threadData.isPending;

  // After the isThreadLoading gate, threadData.data is guaranteed for existing threads.
  // New threads get an empty array — both cases produce UIMessage[].
  const initialMessages: UIMessage[] =
    activeThreadKey != null && threadData.data
      ? (threadData.data.messages as UIMessage[])
      : [];

  const sidebarContent = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-3">
        <Button
          className="justify-start gap-2"
          onClick={handleNewThread}
          variant="ghost"
        >
          <Plus className="h-4 w-4" />
          New chat
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Close sidebar"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => {
                setDesktopSidebarOpen(false);
                setSidebarOpen(false);
              }}
              type="button"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Close sidebar</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        {threadsQuery.data?.threads.map((thread) => {
          const isActive = activeThreadKey === thread.stateKey;
          return (
            <div
              className={cn(
                "group relative flex items-center rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent/50",
                isActive && "bg-accent"
              )}
              key={thread.stateKey}
            >
              <button
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => handleSelectThread(thread.stateKey)}
                type="button"
              >
                {thread.title || "Untitled"}
              </button>
              <button
                aria-label="Delete thread"
                className="ml-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                onClick={() => handleDeleteThread(thread.stateKey)}
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        {threadsQuery.data?.threads.length === 0 && (
          <div className="px-3 py-6 text-center text-muted-foreground text-sm">
            No conversations yet
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar — animates width between 0 and 18rem */}
      <aside
        className={cn(
          "hidden shrink-0 overflow-hidden border-r transition-all duration-200 ease-in-out lg:flex lg:flex-col",
          desktopSidebarOpen ? "w-72" : "w-0 border-r-0"
        )}
      >
        <div className="flex h-full w-72 flex-col">{sidebarContent}</div>
      </aside>
      {/* Desktop reopen button — visible when sidebar is collapsed */}
      {!desktopSidebarOpen && (
        <div className="hidden items-start p-2 lg:flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Open sidebar"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setDesktopSidebarOpen(true)}
                type="button"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Open sidebar</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Mobile sidebar — Sheet */}
      <Sheet onOpenChange={setSidebarOpen} open={sidebarOpen}>
        <SheetContent className="w-72 p-0" hideClose side="left">
          <SheetTitle className="sr-only">Thread history</SheetTitle>
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Chat area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Mobile sidebar toggle */}
        <div className="flex items-center border-b px-2 py-1.5 lg:hidden">
          <button
            aria-label="Open thread list"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent"
            onClick={() => setSidebarOpen(true)}
            type="button"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        {isThreadLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-muted-foreground">Loading thread...</div>
          </div>
        ) : (
          <ChatRuntimeProvider
            defaultModelId={uiDefaultModelId}
            initialMessages={initialMessages}
            initialStateKey={activeThreadKey}
            key={activeThreadKey ?? "new"}
            onAuthExpired={() => signOut()}
            onError={handleError}
            onFinish={handleThreadFinish}
            selectedGraph={selectedGraph}
            selectedModel={selectedModel}
          >
            <Thread
              composerLeft={
                <ChatComposerExtras
                  balance={balance}
                  defaultModelId={uiDefaultModelId}
                  onGraphChange={handleGraphChange}
                  onModelChange={handleModelChange}
                  selectedGraph={selectedGraph}
                  selectedModel={selectedModel}
                />
              }
              errorMessage={
                errorAlertProps ? (
                  <ChatErrorBubble
                    message={errorAlertProps.message}
                    onAddCredits={handleAddCredits}
                    onRetry={handleRetry}
                    onSwitchFreeModel={handleSwitchFreeModel}
                    showAddCredits={errorAlertProps.showAddCredits}
                    showRetry={errorAlertProps.showRetry}
                    showSwitchFree={errorAlertProps.showSwitchFree}
                  />
                ) : undefined
              }
              welcomeMessage={<ChatWelcomeWithHint />}
            />
          </ChatRuntimeProvider>
        )}
      </div>
    </>
  );
}
