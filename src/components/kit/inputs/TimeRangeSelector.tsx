// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/inputs/TimeRangeSelector`
 * Purpose: Time range selector dropdown for filtering time-series data.
 * Scope: Reusable time range picker. Wraps shadcn Select. Does not fetch data or persist filter state.
 * Invariants: Uses shadcn Select component.
 * Side-effects: none
 * Links: [ActivityView](../../../app/(app)/activity/view.tsx)
 * @public
 */

"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/vendor/shadcn/select";

export type TimeRange = "1d" | "1w" | "1m";

export interface TimeRangeSelectorProps {
  className?: string;
  onValueChange: (value: TimeRange) => void;
  value: TimeRange;
}

const timeRangeLabels: Record<TimeRange, string> = {
  "1d": "Last Day",
  "1w": "Last Week",
  "1m": "Last Month",
};

export function TimeRangeSelector({
  value,
  onValueChange,
  className,
}: TimeRangeSelectorProps) {
  return (
    <Select onValueChange={onValueChange} value={value}>
      <SelectTrigger aria-label="Select time range" className={className}>
        <SelectValue placeholder={timeRangeLabels[value]} />
      </SelectTrigger>
      <SelectContent className="rounded-xl">
        <SelectItem className="rounded-lg" value="1d">
          Last Day
        </SelectItem>
        <SelectItem className="rounded-lg" value="1w">
          Last Week
        </SelectItem>
        <SelectItem className="rounded-lg" value="1m">
          Last Month
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
