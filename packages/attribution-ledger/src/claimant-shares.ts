// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-ledger/claimant-shares`
 * Purpose: Defines the canonical claimant-share attribution shape and deterministic expansion/computation helpers.
 * Scope: Defines claimant-share payloads, a default receipt-backed builder, deterministic unit splitting, and claimant-aware proportional credit computation. Does not perform I/O or plugin-specific enrichment.
 * Invariants:
 * - CLAIMANTS_ARE_PLURAL: every attribution subject carries `claimantShares[]`, even when only one claimant is present.
 * - CLAIMANTS_CAN_BE_UNRESOLVED: identity claimants may reference provider + external_id without a resolved user_id.
 * - SUBJECT_KIND_OPEN_ENDED: subjectKind is an open string so plugin-defined attribution subjects do not leak into core enums.
 * - SUBJECT_UNITS_EXPLICIT: each subject carries explicit units.
 * - CLAIMANT_SHARE_SPLIT_DETERMINISTIC: unit splitting uses integer math with largest-remainder tiebroken by claimant key.
 * Side-effects: none
 * Links: docs/spec/attribution-ledger.md
 * @public
 */

export const CLAIMANT_SHARES_EVALUATION_REF = "cogni.claimant_shares.v0";
export const CLAIMANT_SHARES_ALGO_REF = "claimant-shares-v0";
export const CLAIMANT_SHARE_DENOMINATOR_PPM = 1_000_000;

export interface UserClaimant {
  readonly kind: "user";
  readonly userId: string;
}

export interface IdentityClaimant {
  readonly kind: "identity";
  readonly provider: string;
  readonly externalId: string;
  readonly providerLogin: string | null;
}

export type AttributionClaimant = UserClaimant | IdentityClaimant;

export interface ClaimantShare {
  readonly claimant: AttributionClaimant;
  readonly sharePpm: number;
}

export interface ClaimantSharesSubject {
  readonly subjectRef: string;
  readonly subjectKind: string;
  readonly units: string;
  readonly source: string | null;
  readonly eventType: string | null;
  readonly receiptIds: readonly string[];
  readonly claimantShares: readonly ClaimantShare[];
  readonly metadata: Record<string, unknown> | null;
}

export interface ClaimantSharesPayload {
  readonly version: 1;
  readonly subjects: readonly ClaimantSharesSubject[];
}

export interface SelectedReceiptForAttribution {
  readonly receiptId: string;
  readonly userId: string | null;
  readonly source: string;
  readonly eventType: string;
  readonly included: boolean;
  readonly weightOverrideMilli: bigint | null;
  readonly platformUserId: string;
  readonly platformLogin: string | null;
  readonly artifactUrl: string | null;
  readonly eventTime: Date;
  readonly payloadHash: string;
}

export interface ExpandedClaimantUnit {
  readonly subjectRef: string;
  readonly subjectKind: string;
  readonly source: string | null;
  readonly eventType: string | null;
  readonly receiptIds: readonly string[];
  readonly claimant: AttributionClaimant;
  readonly units: bigint;
  readonly metadata: Record<string, unknown> | null;
}

export interface FinalizedClaimantAllocation {
  readonly claimant: AttributionClaimant;
  readonly valuationUnits: bigint;
  readonly receiptIds?: readonly string[];
}

export interface ClaimantCreditLineItem {
  readonly claimant: AttributionClaimant;
  readonly totalUnits: bigint;
  readonly share: string;
  readonly amountCredits: bigint;
  readonly receiptIds: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidSharePpm(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= CLAIMANT_SHARE_DENOMINATOR_PPM
  );
}

export function claimantKey(claimant: AttributionClaimant): string {
  if (claimant.kind === "user") return `user:${claimant.userId}`;
  return `identity:${claimant.provider}:${claimant.externalId}`;
}

export function buildDefaultReceiptClaimantSharesPayload(params: {
  receipts: readonly SelectedReceiptForAttribution[];
  weightConfig: Record<string, number>;
}): ClaimantSharesPayload {
  const subjects: ClaimantSharesSubject[] = [];

  for (const receipt of params.receipts) {
    if (!receipt.included) continue;

    const configKey = `${receipt.source}:${receipt.eventType}`;
    const units =
      receipt.weightOverrideMilli ??
      BigInt(params.weightConfig[configKey] ?? 0);
    if (units <= 0n) continue;

    const claimant: AttributionClaimant = receipt.userId
      ? {
          kind: "user",
          userId: receipt.userId,
        }
      : {
          kind: "identity",
          provider: receipt.source,
          externalId: receipt.platformUserId,
          providerLogin: receipt.platformLogin,
        };

    subjects.push({
      subjectRef: receipt.receiptId,
      subjectKind: "receipt",
      units: units.toString(),
      source: receipt.source,
      eventType: receipt.eventType,
      receiptIds: [receipt.receiptId],
      claimantShares: [
        {
          claimant,
          sharePpm: CLAIMANT_SHARE_DENOMINATOR_PPM,
        },
      ],
      metadata: {
        artifactUrl: receipt.artifactUrl,
        eventTime: receipt.eventTime.toISOString(),
        platformLogin: receipt.platformLogin,
        platformUserId: receipt.platformUserId,
        payloadHash: receipt.payloadHash,
      },
    });
  }

  return {
    version: 1,
    subjects,
  };
}

export function parseClaimantSharesPayload(
  payload: Record<string, unknown> | null
): ClaimantSharesPayload | null {
  if (!isRecord(payload) || payload.version !== 1) return null;
  if (!Array.isArray(payload.subjects)) return null;

  const subjects: ClaimantSharesSubject[] = [];

  for (const subject of payload.subjects) {
    if (!isRecord(subject)) return null;
    if (
      !isNonEmptyString(subject.subjectRef) ||
      !isNonEmptyString(subject.subjectKind) ||
      typeof subject.units !== "string" ||
      !Array.isArray(subject.receiptIds) ||
      !Array.isArray(subject.claimantShares)
    ) {
      return null;
    }

    let units: bigint;
    try {
      units = BigInt(subject.units);
    } catch {
      return null;
    }
    if (units < 0n) return null;

    const claimantShares: ClaimantShare[] = [];
    let shareTotal = 0;

    for (const target of subject.claimantShares) {
      if (!isRecord(target) || !isValidSharePpm(target.sharePpm)) return null;
      if (!isRecord(target.claimant)) return null;

      let claimant: AttributionClaimant;
      if (
        target.claimant.kind === "user" &&
        typeof target.claimant.userId === "string"
      ) {
        claimant = {
          kind: "user",
          userId: target.claimant.userId,
        };
      } else if (
        target.claimant.kind === "identity" &&
        typeof target.claimant.provider === "string" &&
        typeof target.claimant.externalId === "string" &&
        (typeof target.claimant.providerLogin === "string" ||
          target.claimant.providerLogin === null)
      ) {
        claimant = {
          kind: "identity",
          provider: target.claimant.provider,
          externalId: target.claimant.externalId,
          providerLogin: target.claimant.providerLogin,
        };
      } else {
        return null;
      }

      shareTotal += target.sharePpm;
      claimantShares.push({
        claimant,
        sharePpm: target.sharePpm,
      });
    }

    if (
      claimantShares.length === 0 ||
      shareTotal !== CLAIMANT_SHARE_DENOMINATOR_PPM ||
      subject.receiptIds.some((id) => typeof id !== "string")
    ) {
      return null;
    }

    subjects.push({
      subjectRef: subject.subjectRef,
      subjectKind: subject.subjectKind,
      units: units.toString(),
      source: typeof subject.source === "string" ? subject.source : null,
      eventType:
        typeof subject.eventType === "string" ? subject.eventType : null,
      receiptIds: subject.receiptIds,
      claimantShares,
      metadata: isRecord(subject.metadata) ? subject.metadata : null,
    });
  }

  return {
    version: 1,
    subjects,
  };
}

export function expandClaimantUnits(
  payload: ClaimantSharesPayload
): ExpandedClaimantUnit[] {
  const expanded: ExpandedClaimantUnit[] = [];

  for (const subject of payload.subjects) {
    const totalUnits = BigInt(subject.units);
    if (totalUnits <= 0n) continue;

    const provisional = subject.claimantShares.map((target) => {
      const numerator = totalUnits * BigInt(target.sharePpm);
      return {
        claimant: target.claimant,
        floorUnits: numerator / BigInt(CLAIMANT_SHARE_DENOMINATOR_PPM),
        remainder: numerator % BigInt(CLAIMANT_SHARE_DENOMINATOR_PPM),
      };
    });

    let remainderUnits =
      totalUnits - provisional.reduce((sum, item) => sum + item.floorUnits, 0n);

    provisional.sort((a, b) => {
      if (a.remainder === b.remainder) {
        return claimantKey(a.claimant).localeCompare(claimantKey(b.claimant));
      }
      return a.remainder > b.remainder ? -1 : 1;
    });

    for (const item of provisional) {
      const extra = remainderUnits > 0n ? 1n : 0n;
      if (remainderUnits > 0n) remainderUnits--;

      expanded.push({
        subjectRef: subject.subjectRef,
        subjectKind: subject.subjectKind,
        source: subject.source,
        eventType: subject.eventType,
        receiptIds: subject.receiptIds,
        claimant: item.claimant,
        units: item.floorUnits + extra,
        metadata: subject.metadata,
      });
    }
  }

  return expanded.sort((a, b) => {
    const subjectCompare = a.subjectRef.localeCompare(b.subjectRef);
    if (subjectCompare !== 0) return subjectCompare;
    return claimantKey(a.claimant).localeCompare(claimantKey(b.claimant));
  });
}

export function computeClaimantCreditLineItems(
  allocations: readonly FinalizedClaimantAllocation[],
  poolTotalCredits: bigint
): ClaimantCreditLineItem[] {
  if (allocations.length === 0) {
    return [];
  }

  if (poolTotalCredits <= 0n) {
    return [];
  }

  const claimantUnits = new Map<
    string,
    {
      claimant: AttributionClaimant;
      totalUnits: bigint;
      receiptIds: Set<string>;
    }
  >();

  for (const allocation of allocations) {
    if (allocation.valuationUnits < 0n) {
      throw new RangeError(
        `Negative valuationUnits for claimant ${claimantKey(allocation.claimant)}: ${allocation.valuationUnits}`
      );
    }

    const key = claimantKey(allocation.claimant);
    const existing = claimantUnits.get(key);
    if (existing) {
      existing.totalUnits += allocation.valuationUnits;
      for (const receiptId of allocation.receiptIds ?? []) {
        existing.receiptIds.add(receiptId);
      }
      continue;
    }

    claimantUnits.set(key, {
      claimant: allocation.claimant,
      totalUnits: allocation.valuationUnits,
      receiptIds: new Set(allocation.receiptIds ?? []),
    });
  }

  let totalUnits = 0n;
  for (const entry of claimantUnits.values()) {
    totalUnits += entry.totalUnits;
  }

  if (totalUnits === 0n) {
    return [];
  }

  const sortedClaimants = [...claimantUnits.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const floorAllocations: Array<{
    claimantKey: string;
    claimant: AttributionClaimant;
    totalUnits: bigint;
    receiptIds: readonly string[];
    floor: bigint;
    remainder: bigint;
  }> = [];

  let floorSum = 0n;

  for (const [key, entry] of sortedClaimants) {
    const floor = (entry.totalUnits * poolTotalCredits) / totalUnits;
    const remainder = (entry.totalUnits * poolTotalCredits) % totalUnits;

    floorAllocations.push({
      claimantKey: key,
      claimant: entry.claimant,
      totalUnits: entry.totalUnits,
      receiptIds: [...entry.receiptIds].sort(),
      floor,
      remainder,
    });
    floorSum += floor;
  }

  let residual = poolTotalCredits - floorSum;

  const byRemainder = [...floorAllocations].sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder > a.remainder ? 1 : -1;
    }
    return a.claimantKey.localeCompare(b.claimantKey);
  });

  const bonuses = new Map<string, bigint>();
  for (const allocation of byRemainder) {
    if (residual <= 0n) break;
    bonuses.set(allocation.claimantKey, 1n);
    residual -= 1n;
  }

  return floorAllocations.map(
    ({ claimantKey: key, claimant, totalUnits: units, receiptIds, floor }) => {
      const bonus = bonuses.get(key) ?? 0n;
      const amountCredits = floor + bonus;

      const shareScale = 10n ** 6n;
      const scaledShare = (units * shareScale) / totalUnits;
      const wholePart = scaledShare / shareScale;
      const fracPart = scaledShare % shareScale;
      const share = `${wholePart}.${fracPart.toString().padStart(6, "0")}`;

      return {
        claimant,
        totalUnits: units,
        share,
        amountCredits,
        receiptIds,
      };
    }
  );
}

export function buildClaimantAllocations(
  subjects: readonly ClaimantSharesSubject[],
  userUnitOverrides: ReadonlyMap<string, bigint> = new Map()
): FinalizedClaimantAllocation[] {
  const grouped = new Map<
    string,
    {
      claimant: AttributionClaimant;
      valuationUnits: bigint;
      receiptIds: Set<string>;
    }
  >();

  for (const item of expandClaimantUnits({ version: 1, subjects })) {
    const key = claimantKey(item.claimant);
    const existing = grouped.get(key);
    if (existing) {
      existing.valuationUnits += item.units;
      for (const receiptId of item.receiptIds) {
        existing.receiptIds.add(receiptId);
      }
      continue;
    }

    grouped.set(key, {
      claimant: item.claimant,
      valuationUnits: item.units,
      receiptIds: new Set(item.receiptIds),
    });
  }

  for (const [userId, units] of userUnitOverrides.entries()) {
    const claimant: AttributionClaimant = {
      kind: "user",
      userId,
    };
    const key = claimantKey(claimant);
    const existing = grouped.get(key);
    if (existing) {
      existing.valuationUnits = units;
      continue;
    }

    grouped.set(key, {
      claimant,
      valuationUnits: units,
      receiptIds: new Set(),
    });
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, entry]) => ({
      claimant: entry.claimant,
      valuationUnits: entry.valuationUnits,
      receiptIds: [...entry.receiptIds].sort(),
    }));
}
