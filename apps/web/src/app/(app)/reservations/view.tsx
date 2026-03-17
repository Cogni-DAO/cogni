// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/reservations/view`
 * Purpose: Client-side view for the reservation assistant dashboard.
 * Scope: Watch list, create dialog, detail panel with event timeline, and alert ingest.
 * Invariants: All API shapes from contracts; uses existing kit components.
 * Side-effects: IO
 * Links: task.0166
 * @public
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  ChevronLeft,
  Clock,
  Eye,
  Pause,
  Play,
  Plus,
  Send,
  Users,
  X,
} from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components";
import type { WatchEventResponse } from "@/contracts/reservations.events.v1.contract";
import type { WatchRequestResponse } from "@/contracts/reservations.watch.v1.contract";
import {
  createWatch,
  fetchBookings,
  fetchEvents,
  fetchWatches,
  ingestAlert,
  updateWatchStatus,
} from "./_api/reservation-api";

/* ─── Status Badge ───────────────────────────────────────────────── */

const STATUS_BADGE_INTENT = {
  active: "default",
  paused: "secondary",
  fulfilled: "outline",
  cancelled: "destructive",
  expired: "secondary",
} as const;

function StatusBadge({
  status,
}: {
  status: WatchRequestResponse["status"];
}): ReactElement {
  return (
    <Badge intent={STATUS_BADGE_INTENT[status]} size="sm">
      {status}
    </Badge>
  );
}

/* ─── Event Type Label ───────────────────────────────────────────── */

const EVENT_LABELS: Record<string, string> = {
  created: "Watch Created",
  alert_received: "Alert Received",
  user_approved: "User Approved",
  user_declined: "User Declined",
  booking_started: "Booking Started",
  booking_succeeded: "Booking Succeeded",
  booking_failed: "Booking Failed",
  paused: "Paused",
  resumed: "Resumed",
  cancelled: "Cancelled",
  expired: "Expired",
};

/* ─── Create Watch Dialog ────────────────────────────────────────── */

function CreateWatchDialog({
  onCreated,
}: {
  onCreated: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<"resy" | "opentable" | "other">(
    "resy"
  );
  const [venue, setVenue] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");

  const mutation = useMutation({
    mutationFn: createWatch,
    onSuccess: () => {
      setOpen(false);
      resetForm();
      onCreated();
    },
  });

  function resetForm(): void {
    setVenue("");
    setPartySize("2");
    setDateStart("");
    setDateEnd("");
    setTimeStart("");
    setTimeEnd("");
  }

  const canSubmit =
    venue.length > 0 &&
    /^\d+$/.test(partySize) &&
    dateStart.length > 0 &&
    dateEnd.length > 0;

  function handleSubmit(): void {
    mutation.mutate({
      platform,
      venue,
      partySize,
      dateStart: new Date(dateStart).toISOString(),
      dateEnd: new Date(dateEnd).toISOString(),
      ...(timeStart ? { preferredTimeStart: timeStart } : {}),
      ...(timeEnd ? { preferredTimeEnd: timeEnd } : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 size-4" />
          New Watch
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Watch Request</DialogTitle>
          <DialogDescription>
            Monitor a restaurant for availability on a given platform.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="font-medium text-sm" htmlFor="platform">
              Platform
            </label>
            <Select
              value={platform}
              onValueChange={(v) => setPlatform(v as typeof platform)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="resy">Resy</SelectItem>
                <SelectItem value="opentable">OpenTable</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <label className="font-medium text-sm" htmlFor="venue">
              Restaurant Name
            </label>
            <Input
              id="venue"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="e.g. Carbone"
            />
          </div>

          <div className="grid gap-2">
            <label className="font-medium text-sm" htmlFor="partySize">
              Party Size
            </label>
            <Input
              id="partySize"
              value={partySize}
              onChange={(e) => setPartySize(e.target.value)}
              placeholder="2"
              type="number"
              min="1"
              max="20"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label className="font-medium text-sm" htmlFor="dateStart">
                Start Date
              </label>
              <Input
                id="dateStart"
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <label className="font-medium text-sm" htmlFor="dateEnd">
                End Date
              </label>
              <Input
                id="dateEnd"
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label className="font-medium text-sm" htmlFor="timeStart">
                Preferred Time (from)
              </label>
              <Input
                id="timeStart"
                type="time"
                value={timeStart}
                onChange={(e) => setTimeStart(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <label className="font-medium text-sm" htmlFor="timeEnd">
                Preferred Time (to)
              </label>
              <Input
                id="timeEnd"
                type="time"
                value={timeEnd}
                onChange={(e) => setTimeEnd(e.target.value)}
              />
            </div>
          </div>
        </div>

        {mutation.error && (
          <p className="text-destructive text-sm">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "Failed to create watch"}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? "Creating..." : "Create Watch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Ingest Alert Dialog ────────────────────────────────────────── */

function IngestAlertDialog({
  watchId,
  onIngested,
}: {
  watchId: string;
  onIngested: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"manual" | "email" | "webhook">(
    "manual"
  );
  const [message, setMessage] = useState("");

  const mutation = useMutation({
    mutationFn: ingestAlert,
    onSuccess: () => {
      setOpen(false);
      setMessage("");
      onIngested();
    },
  });

  function handleSubmit(): void {
    mutation.mutate({
      watchRequestId: watchId,
      source,
      payload: { message },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Send className="mr-1 size-4" />
          Ingest Alert
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ingest Availability Alert</DialogTitle>
          <DialogDescription>
            Paste an availability notification you received from the platform.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="font-medium text-sm" htmlFor="ingest-source">
              Source
            </label>
            <Select
              value={source}
              onValueChange={(v) => setSource(v as typeof source)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="email">Email Forward</SelectItem>
                <SelectItem value="webhook">Webhook</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <label className="font-medium text-sm" htmlFor="ingest-message">
              Notification Content
            </label>
            <textarea
              id="ingest-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Table available at 7:30 PM on April 15"
              rows={4}
              className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        </div>

        {mutation.error && (
          <p className="text-destructive text-sm">
            {mutation.error instanceof Error
              ? mutation.error.message
              : "Failed to ingest alert"}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={message.length === 0 || mutation.isPending}
          >
            {mutation.isPending ? "Submitting..." : "Submit Alert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Watch Detail Panel ─────────────────────────────────────────── */

function WatchDetailPanel({
  watch,
  onBack,
}: {
  watch: WatchRequestResponse;
  onBack: () => void;
}): ReactElement {
  const queryClient = useQueryClient();

  const eventsQuery = useQuery({
    queryKey: ["reservation-events", watch.id],
    queryFn: () => fetchEvents(watch.id),
    staleTime: 10_000,
  });

  const bookingsQuery = useQuery({
    queryKey: ["reservation-bookings", watch.id],
    queryFn: () => fetchBookings(watch.id),
    staleTime: 10_000,
  });

  function invalidateAll(): void {
    void queryClient.invalidateQueries({
      queryKey: ["reservation-events", watch.id],
    });
    void queryClient.invalidateQueries({
      queryKey: ["reservation-bookings", watch.id],
    });
    void queryClient.invalidateQueries({ queryKey: ["watches"] });
  }

  const events = eventsQuery.data?.events ?? [];
  const bookings = bookingsQuery.data?.attempts ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h2 className="font-semibold text-xl">{watch.venue}</h2>
          <p className="text-muted-foreground text-sm">
            {watch.platform} &middot; <StatusBadge status={watch.status} />
          </p>
        </div>
        {watch.status === "active" && (
          <IngestAlertDialog watchId={watch.id} onIngested={invalidateAll} />
        )}
      </div>

      {/* Details Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <span>Party of {watch.partySize}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-muted-foreground" />
              <span>
                {formatDate(watch.dateStart)} &ndash;{" "}
                {formatDate(watch.dateEnd)}
              </span>
            </div>
            {watch.preferredTimeStart && (
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <span>
                  {watch.preferredTimeStart}
                  {watch.preferredTimeEnd ? ` - ${watch.preferredTimeEnd}` : ""}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Event Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {eventsQuery.isLoading ? (
            <div className="animate-pulse space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-md bg-muted" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <p className="text-muted-foreground text-sm">No events yet.</p>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Booking Attempts */}
      {bookings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Booking Attempts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {bookings.map((attempt) => (
                <div
                  key={attempt.id}
                  className="flex items-center justify-between rounded-md border border-border p-3"
                >
                  <div>
                    <Badge
                      intent={
                        attempt.status === "succeeded"
                          ? "default"
                          : attempt.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                      size="sm"
                    >
                      {attempt.status}
                    </Badge>
                    <span className="ml-2 text-muted-foreground text-sm">
                      {formatDateTime(attempt.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EventRow({ event }: { event: WatchEventResponse }): ReactElement {
  const label = EVENT_LABELS[event.eventType] ?? event.eventType;
  return (
    <div className="flex items-start gap-3 rounded-md border border-border p-3">
      <div className="mt-0.5 size-2 shrink-0 rounded-full bg-primary" />
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm">{label}</span>
          <span className="text-muted-foreground text-xs">
            {formatDateTime(event.createdAt)}
          </span>
        </div>
        {event.payloadJson && (
          <p className="text-muted-foreground text-xs">
            {typeof event.payloadJson === "object" &&
            "message" in event.payloadJson
              ? String(event.payloadJson.message)
              : JSON.stringify(event.payloadJson)}
          </p>
        )}
        <span className="text-muted-foreground text-xs">
          via {event.source}
        </span>
      </div>
    </div>
  );
}

/* ─── Watch List ─────────────────────────────────────────────────── */

function WatchCard({
  watch,
  onSelect,
  onStatusChange,
}: {
  watch: WatchRequestResponse;
  onSelect: () => void;
  onStatusChange: (
    id: string,
    status: "active" | "paused" | "cancelled"
  ) => void;
}): ReactElement {
  const isTerminal =
    watch.status === "cancelled" ||
    watch.status === "fulfilled" ||
    watch.status === "expired";

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <button type="button" className="flex-1 text-left" onClick={onSelect}>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{watch.venue}</h3>
              <StatusBadge status={watch.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-muted-foreground text-sm">
              <span className="capitalize">{watch.platform}</span>
              <span className="flex items-center gap-1">
                <Users className="size-3" />
                {watch.partySize}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="size-3" />
                {formatDate(watch.dateStart)} &ndash;{" "}
                {formatDate(watch.dateEnd)}
              </span>
              {watch.preferredTimeStart && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {watch.preferredTimeStart}
                  {watch.preferredTimeEnd ? `-${watch.preferredTimeEnd}` : ""}
                </span>
              )}
            </div>
          </button>

          {!isTerminal && (
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect();
                }}
              >
                <Eye className="size-4" />
              </Button>
              {watch.status === "active" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStatusChange(watch.id, "paused");
                  }}
                >
                  <Pause className="size-4" />
                </Button>
              ) : watch.status === "paused" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStatusChange(watch.id, "active");
                  }}
                >
                  <Play className="size-4" />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onStatusChange(watch.id, "cancelled");
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Helpers ────────────────────────────────────────────────────── */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ─── Main View ──────────────────────────────────────────────────── */

export function ReservationsView(): ReactElement {
  const queryClient = useQueryClient();
  const [selectedWatch, setSelectedWatch] =
    useState<WatchRequestResponse | null>(null);

  const watchesQuery = useQuery({
    queryKey: ["watches"],
    queryFn: fetchWatches,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: 2,
  });

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "active" | "paused" | "cancelled";
    }) => updateWatchStatus(id, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["watches"] });
    },
  });

  function handleStatusChange(
    id: string,
    status: "active" | "paused" | "cancelled"
  ): void {
    statusMutation.mutate({ id, status });
  }

  if (watchesQuery.error) {
    return (
      <div className="flex flex-col gap-6 p-5 md:p-6">
        <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
          <h2 className="font-semibold text-destructive text-lg">
            Error loading watches
          </h2>
          <p className="text-muted-foreground text-sm">
            {watchesQuery.error instanceof Error
              ? watchesQuery.error.message
              : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  // Detail view
  if (selectedWatch) {
    return (
      <div className="flex flex-col gap-6 p-5 md:p-6">
        <WatchDetailPanel
          watch={selectedWatch}
          onBack={() => setSelectedWatch(null)}
        />
      </div>
    );
  }

  // List view
  const watches = watchesQuery.data?.watches ?? [];

  return (
    <div className="flex flex-col gap-6 p-5 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-bold text-2xl tracking-tight">Reservations</h1>
        <CreateWatchDialog
          onCreated={() =>
            void queryClient.invalidateQueries({ queryKey: ["watches"] })
          }
        />
      </div>

      {watchesQuery.isLoading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-muted" />
          ))}
        </div>
      ) : watches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Eye className="mb-3 size-10 text-muted-foreground" />
            <h3 className="font-semibold text-lg">No watches yet</h3>
            <p className="mt-1 text-muted-foreground text-sm">
              Create a watch to start monitoring restaurant availability.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {watches.map((watch) => (
            <WatchCard
              key={watch.id}
              watch={watch}
              onSelect={() => setSelectedWatch(watch)}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}

      {statusMutation.error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-destructive text-sm">
            {statusMutation.error instanceof Error
              ? statusMutation.error.message
              : "Failed to update status"}
          </p>
        </div>
      )}
    </div>
  );
}
