// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

"use client";

import { ListFilter } from "lucide-react";
import type { ReactElement } from "react";

import {
  Badge,
  Button,
  Checkbox,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
} from "@/components";

interface FacetedFilterProps {
  readonly title: string;
  readonly options: readonly string[];
  readonly selected: readonly string[];
  readonly onChange: (values: string[]) => void;
}

export function FacetedFilter({
  title,
  options,
  selected,
  onChange,
}: FacetedFilterProps): ReactElement {
  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <ListFilter className="size-3.5" />
          {title}
          {selected.length > 0 && (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <Badge intent="secondary" size="sm">
                {selected.length}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="flex flex-col gap-0.5">
          {options.map((option) => (
            <button
              type="button"
              key={option}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => toggle(option)}
            >
              <Checkbox
                checked={selected.includes(option)}
                tabIndex={-1}
                aria-hidden
              />
              <span className="capitalize">
                {option.replace("needs_", "").replaceAll("_", " ")}
              </span>
            </button>
          ))}
        </div>
        {selected.length > 0 && (
          <>
            <Separator className="my-1.5" />
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-center text-muted-foreground text-xs hover:bg-accent"
              onClick={() => onChange([])}
            >
              Clear
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
