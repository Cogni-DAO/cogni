"use client";

// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/planner/view`
 * Purpose: 24-hour grid visualization of scheduled graph executions.
 * Scope: Client-side rendering of schedules grouped by hour. Reuses existing schedule API.
 * Invariants: Read-only view — mutations go through /schedules page or AI tools.
 * Side-effects: IO (fetches schedules + agents)
 * @public
 */

import { useQuery } from "@tanstack/react-query";
import { Clock, Lock } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";
import { fetchAgents } from "@/app/(app)/schedules/_api/fetchAgents";
import { fetchSchedules } from "@/app/(app)/schedules/_api/fetchSchedules";
import { Badge, Button } from "@/components";

/**
 * Parse hour from a cron expression.
 * Returns the hour (0-23) if the cron is "M H * * *" pattern, null otherwise.
 */
function parseCronHour(cron: string): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const hourPart = parts[1] ?? "";
  const hour = Number.parseInt(hourPart, 10);
  if (Number.isNaN(hour) || hour < 0 || hour > 23) return null;
  // Only match fixed-hour crons (not */N or ranges)
  if (hourPart.includes("/") || hourPart.includes("-") || hourPart === "*")
    return null;
  return hour;
}

function formatHour(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h}:00 ${period}`;
}

interface HourSlot {
  hour: number;
  schedules: Array<{
    id: string;
    graphId: string;
    cron: string;
    enabled: boolean;
    editPolicy: string;
    input: Record<string, unknown>;
  }>;
}

export function PlannerView(): ReactElement {
  const {
    data: schedulesData,
    isLoading: schedulesLoading,
    error: schedulesError,
  } = useQuery({
    queryKey: ["schedules"],
    queryFn: fetchSchedules,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 2,
  });

  const { data: agentsData } = useQuery({
    queryKey: ["agents"],
    queryFn: fetchAgents,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: 2,
  });

  // Build agent lookup for display names
  const agentNames: Record<string, string> = {};
  if (agentsData?.agents) {
    for (const agent of agentsData.agents) {
      agentNames[agent.graphId] = agent.name;
    }
  }

  // Group schedules into 24-hour slots
  const hourSlots: HourSlot[] = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    schedules: [],
  }));

  // Track schedules that don't fit hourly grid
  const nonHourly: HourSlot["schedules"] = [];

  if (schedulesData?.schedules) {
    for (const schedule of schedulesData.schedules) {
      const hour = parseCronHour(schedule.cron);
      const meta = (schedule.input as Record<string, unknown>)?._meta as
        | { editPolicy?: string }
        | undefined;
      const entry = {
        id: schedule.id,
        graphId: schedule.graphId,
        cron: schedule.cron,
        enabled: schedule.enabled,
        editPolicy: meta?.editPolicy ?? "ai_managed",
        input: schedule.input,
      };
      const slot = hour !== null ? hourSlots[hour] : undefined;
      if (slot) {
        slot.schedules.push(entry);
      } else {
        nonHourly.push(entry);
      }
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl">Planner</h1>
          <p className="text-muted-foreground text-sm">
            24-hour view of scheduled graph executions
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/schedules">Manage Schedules</Link>
        </Button>
      </div>

      {schedulesError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700 text-sm dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          Failed to load schedules: {String(schedulesError)}
        </div>
      )}

      {schedulesLoading ? (
        <div className="text-muted-foreground text-sm">
          Loading schedules...
        </div>
      ) : (
        <div className="grid gap-1">
          {hourSlots.map((slot) => (
            <div
              key={slot.hour}
              className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
                slot.schedules.length > 0
                  ? "border-primary/30 bg-primary/5"
                  : "border-border/50"
              }`}
            >
              <div className="w-20 shrink-0 font-mono text-muted-foreground text-sm">
                {formatHour(slot.hour)}
              </div>

              {slot.schedules.length === 0 ? (
                <div className="text-muted-foreground/50 text-sm">—</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {slot.schedules.map((s) => (
                    <div key={s.id} className="flex items-center gap-1.5">
                      <Badge
                        intent={s.enabled ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {agentNames[s.graphId] ??
                          s.graphId.split(":").pop() ??
                          s.graphId}
                      </Badge>
                      {s.editPolicy === "human_only" && (
                        <Lock
                          className="h-3 w-3 text-muted-foreground"
                          aria-label="Human-only — AI cannot modify"
                        />
                      )}
                      {!s.enabled && (
                        <span className="text-muted-foreground text-xs">
                          (paused)
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {nonHourly.length > 0 && (
        <div className="mt-4">
          <h2 className="mb-2 flex items-center gap-1 font-medium text-muted-foreground text-sm">
            <Clock className="h-3.5 w-3.5" />
            Non-hourly schedules
          </h2>
          <div className="flex flex-wrap gap-2">
            {nonHourly.map((s) => (
              <Badge key={s.id} intent="outline" className="text-xs">
                {agentNames[s.graphId] ??
                  s.graphId.split(":").pop() ??
                  s.graphId}{" "}
                <span className="ml-1 text-muted-foreground">({s.cron})</span>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
