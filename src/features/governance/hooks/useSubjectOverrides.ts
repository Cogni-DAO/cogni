// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/hooks/useSubjectOverrides`
 * Purpose: CRUD hook for subject-level review overrides during epoch review.
 * Scope: Client-side data fetching and mutation for subject overrides. Does not perform server-side logic.
 * Invariants: WRITE_ROUTES_APPROVER_GATED (server enforces). BigInt overrideUnits serialized as strings.
 * Side-effects: IO (HTTP fetches to subject-overrides API)
 * Links: src/contracts/attribution.subject-overrides.v1.contract.ts
 * @public
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** Shape of a single override as returned by the GET endpoint. */
export interface SubjectOverrideView {
  readonly id: string;
  readonly subjectRef: string;
  readonly overrideUnits: string | null;
  readonly overrideReason: string | null;
}

interface UseSubjectOverridesReturn {
  /** Map of subjectRef → override for O(1) lookup. */
  readonly overridesByRef: ReadonlyMap<string, SubjectOverrideView>;
  readonly isLoading: boolean;
  /** Save (upsert) an override for a subject. */
  readonly saveOverride: (
    subjectRef: string,
    overrideUnits: string,
    reason?: string
  ) => Promise<void>;
  /** Remove an override for a subject. */
  readonly removeOverride: (subjectRef: string) => Promise<void>;
  readonly isSaving: boolean;
}

function overridesQueryKey(epochId: string): readonly string[] {
  return ["governance", "epochs", epochId, "subject-overrides"] as const;
}

export function useSubjectOverrides(
  epochId: string
): UseSubjectOverridesReturn {
  const queryClient = useQueryClient();
  const qk = overridesQueryKey(epochId);

  const { data, isLoading } = useQuery({
    queryKey: qk,
    queryFn: async (): Promise<SubjectOverrideView[]> => {
      const res = await fetch(
        `/api/v1/attribution/epochs/${epochId}/subject-overrides`,
        { credentials: "same-origin" }
      );
      if (!res.ok) throw new Error("Failed to fetch overrides");
      const json = (await res.json()) as {
        overrides: SubjectOverrideView[];
      };
      return json.overrides;
    },
    staleTime: 30_000,
  });

  const overridesByRef = new Map<string, SubjectOverrideView>();
  if (data) {
    for (const o of data) {
      overridesByRef.set(o.subjectRef, o);
    }
  }

  const upsertMutation = useMutation({
    mutationFn: async (params: {
      subjectRef: string;
      overrideUnits: string;
      reason?: string | undefined;
    }) => {
      const res = await fetch(
        `/api/v1/attribution/epochs/${epochId}/subject-overrides`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            overrides: [
              {
                subjectRef: params.subjectRef,
                overrideUnits: params.overrideUnits,
                overrideReason: params.reason ?? null,
              },
            ],
          }),
        }
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Failed to save override: ${body}`);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk });
      // Also invalidate the review epochs query so totals refresh
      void queryClient.invalidateQueries({
        queryKey: ["governance", "epochs", "review"],
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (subjectRef: string) => {
      const res = await fetch(
        `/api/v1/attribution/epochs/${epochId}/subject-overrides`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ subjectRef }),
        }
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Failed to delete override: ${body}`);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk });
      void queryClient.invalidateQueries({
        queryKey: ["governance", "epochs", "review"],
      });
    },
  });

  const saveOverride = useCallback(
    async (subjectRef: string, overrideUnits: string, reason?: string) => {
      await upsertMutation.mutateAsync({ subjectRef, overrideUnits, reason });
    },
    [upsertMutation]
  );

  const removeOverride = useCallback(
    async (subjectRef: string) => {
      await deleteMutation.mutateAsync(subjectRef);
    },
    [deleteMutation]
  );

  return {
    overridesByRef,
    isLoading,
    saveOverride,
    removeOverride,
    isSaving: upsertMutation.isPending || deleteMutation.isPending,
  };
}
