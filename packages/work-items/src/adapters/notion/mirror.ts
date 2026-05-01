// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/work-items/notion/mirror`
 * Purpose: Notion data-source mirror for Cogni-owned work items.
 * Scope: Reads/writes Notion pages keyed by exact Cogni work item IDs. Does not allocate IDs or act as source of truth.
 * Invariants:
 * - COGNI_ID_IS_AUTHORITY: Notion pages are keyed by the exact `WorkItem.id` from Cogni.
 * - DOLT_IS_SOURCE_OF_TRUTH: This mirror only projects and reads editable deltas; callers decide when to patch Cogni.
 * - SYNC_HASH_DETECTS_EDITS: Human edits are detected by comparing current Notion editable fields to the last synced hash.
 * Side-effects: IO (HTTP requests to Notion API)
 * Links: docs/spec/work-items-port.md
 * @public
 */

import { createHash } from "node:crypto";

import type {
  WorkItem,
  WorkItemId,
  WorkItemStatus,
  WorkItemType,
} from "../../types.js";
import { toWorkItemId } from "../../types.js";

const DEFAULT_NOTION_VERSION = "2025-09-03";
const DEFAULT_BASE_URL = "https://api.notion.com/v1";
const MAX_RICH_TEXT_SEGMENT = 1800;

const DEFAULT_PROPERTIES = {
  title: "Name",
  id: "Cogni ID",
  type: "Type",
  status: "Status",
  node: "Node",
  priority: "Priority",
  rank: "Rank",
  estimate: "Estimate",
  summary: "Summary",
  outcome: "Outcome",
  labels: "Labels",
  branch: "Branch",
  pr: "PR",
  reviewer: "Reviewer",
  cogniRevision: "Cogni Revision",
  syncHash: "Sync Hash",
  syncState: "Sync State",
  syncError: "Sync Error",
  lastSyncedAt: "Last Synced At",
} as const;

type FetchLike = typeof fetch;
type PropertyKey = keyof typeof DEFAULT_PROPERTIES;
type PropertyNames = Record<PropertyKey, string>;
type PropertyType =
  | "checkbox"
  | "date"
  | "multi_select"
  | "number"
  | "rich_text"
  | "select"
  | "status"
  | "title"
  | "url";

type NotionText = {
  plain_text?: string;
  text?: { content?: string };
};

type NotionSelect = {
  name?: string;
};

type NotionPageProperty = {
  id?: string;
  type?: string;
  checkbox?: boolean;
  date?: { start?: string | null } | null;
  multi_select?: NotionSelect[];
  number?: number | null;
  rich_text?: NotionText[];
  select?: NotionSelect | null;
  status?: NotionSelect | null;
  title?: NotionText[];
  url?: string | null;
};

type NotionPage = {
  object: "page";
  id: string;
  url?: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, NotionPageProperty>;
};

type NotionDataSource = {
  object: "data_source";
  id: string;
  properties: Record<string, { id?: string; type?: string }>;
};

type NotionQueryResponse = {
  results?: NotionPage[];
  has_more?: boolean;
  next_cursor?: string | null;
};

type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};

export type WorkItemNotionEditable = Mutable<
  Pick<
    WorkItem,
    | "title"
    | "status"
    | "node"
    | "priority"
    | "rank"
    | "estimate"
    | "summary"
    | "outcome"
    | "labels"
    | "branch"
    | "pr"
    | "reviewer"
  >
>;

export type WorkItemNotionPatch = Partial<WorkItemNotionEditable>;

export interface NotionWorkItemMirrorConfig {
  authToken: string;
  dataSourceId: string;
  notionVersion?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  propertyNames?: Partial<PropertyNames>;
}

export interface NotionWorkItemPage {
  pageId: string;
  lastEditedTime: string;
  url?: string;
  cogniId?: WorkItemId;
  cogniRevision?: number;
  syncHash?: string;
  syncState?: string;
  syncError?: string;
  validationErrors: string[];
  editable: Partial<WorkItemNotionEditable>;
}

export type NotionUpsertResult = {
  pageId: string;
  action: "created" | "updated";
};

function chunkText(input: string, size = MAX_RICH_TEXT_SEGMENT): string[] {
  if (!input) return [];
  const chunks: string[] = [];
  for (let index = 0; index < input.length; index += size) {
    chunks.push(input.slice(index, index + size));
  }
  return chunks;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function textValue(text: string): Array<{ text: { content: string } }> {
  return chunkText(text).map((content) => ({ text: { content } }));
}

function textFromProperty(property: NotionPageProperty | undefined): string {
  if (!property) return "";
  if (property.type === "title") {
    return (property.title ?? [])
      .map((part) => part.plain_text ?? part.text?.content ?? "")
      .join("");
  }
  if (property.type === "rich_text") {
    return (property.rich_text ?? [])
      .map((part) => part.plain_text ?? part.text?.content ?? "")
      .join("");
  }
  if (property.type === "select") return property.select?.name ?? "";
  if (property.type === "status") return property.status?.name ?? "";
  if (property.type === "url") return property.url ?? "";
  if (property.type === "number") return property.number?.toString() ?? "";
  if (property.type === "checkbox") return property.checkbox ? "true" : "false";
  if (property.type === "date") return property.date?.start ?? "";
  if (property.type === "multi_select") {
    return (property.multi_select ?? [])
      .map((entry) => entry.name ?? "")
      .join(", ");
  }
  return "";
}

function numberFromProperty(
  property: NotionPageProperty | undefined
): number | undefined {
  if (!property) return undefined;
  if (property.type === "number") return property.number ?? undefined;
  const raw = textFromProperty(property).trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringArrayFromProperty(
  property: NotionPageProperty | undefined
): string[] {
  if (!property) return [];
  if (property.type === "multi_select") {
    return (property.multi_select ?? []).flatMap((entry) =>
      entry.name ? [entry.name] : []
    );
  }
  const raw = textFromProperty(property).trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function asStatus(value: string): WorkItemStatus | undefined {
  const normalized = value === "Done" ? "done" : value;
  switch (normalized) {
    case "needs_triage":
    case "needs_research":
    case "needs_design":
    case "needs_implement":
    case "needs_closeout":
    case "needs_merge":
    case "done":
    case "blocked":
    case "cancelled":
      return normalized;
    default:
      return undefined;
  }
}

function invalidStatusMessage(value: string): string {
  return `Invalid Notion Status "${value}". Use exact Cogni lifecycle status: needs_triage, needs_research, needs_design, needs_implement, needs_closeout, needs_merge, done, blocked, cancelled.`;
}

function notionStatusName(status: WorkItemStatus): string {
  return status === "done" ? "Done" : status;
}

function asType(value: string): WorkItemType | undefined {
  return value === "task" ||
    value === "bug" ||
    value === "story" ||
    value === "spike" ||
    value === "subtask"
    ? value
    : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}

function editableFromItem(item: WorkItem): WorkItemNotionEditable {
  return stripUndefined({
    title: item.title,
    status: item.status,
    node: item.node,
    priority: item.priority,
    rank: item.rank,
    estimate: item.estimate,
    summary: item.summary,
    outcome: item.outcome,
    labels: [...item.labels],
    branch: item.branch,
    pr: item.pr,
    reviewer: item.reviewer,
  });
}

function normalizeEditable(
  value: Partial<WorkItemNotionEditable>
): Partial<WorkItemNotionEditable> {
  return stripUndefined({
    ...value,
    labels: value.labels ? sortedStrings(value.labels) : undefined,
  });
}

function differs(a: unknown, b: unknown): boolean {
  return stableStringify(a) !== stableStringify(b);
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function setIfStringChanged<K extends keyof WorkItemNotionPatch>(
  patch: WorkItemNotionPatch,
  key: K,
  value: string | undefined,
  current: string | undefined
): void {
  if (value && value !== current) patch[key] = value as WorkItemNotionPatch[K];
}

function setIfNumberChanged<K extends keyof WorkItemNotionPatch>(
  patch: WorkItemNotionPatch,
  key: K,
  value: number | undefined,
  current: number | undefined
): void {
  if (value !== undefined && value !== current) {
    patch[key] = value as WorkItemNotionPatch[K];
  }
}

function propertyText(value: number | string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

function propertyStringArray(
  value: number | string | string[] | undefined
): string[] {
  if (Array.isArray(value)) return value;
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function propertyPayload(
  propertyType: PropertyType,
  value: number | string | string[] | undefined
): unknown {
  const text = propertyText(value);
  switch (propertyType) {
    case "title":
      return { title: textValue(text) };
    case "rich_text":
      return { rich_text: textValue(text) };
    case "select":
    case "status":
      return { [propertyType]: text ? { name: text } : null };
    case "multi_select":
      return {
        multi_select: propertyStringArray(value).map((entry) => ({
          name: entry,
        })),
      };
    case "number": {
      const numberValue = typeof value === "number" ? value : Number(value);
      return { number: Number.isFinite(numberValue) ? numberValue : null };
    }
    case "url":
      return { url: text || null };
    case "date":
      return { date: text ? { start: text } : null };
    case "checkbox":
      return { checkbox: value === "true" || value === 1 };
  }
}

export class NotionWorkItemMirror {
  private readonly fetchImpl: FetchLike;
  private readonly notionVersion: string;
  private readonly baseUrl: string;
  private readonly propertyNames: PropertyNames;
  private schemaPromise?: Promise<NotionDataSource>;

  constructor(private readonly config: NotionWorkItemMirrorConfig) {
    this.fetchImpl = config.fetch ?? fetch;
    this.notionVersion = config.notionVersion ?? DEFAULT_NOTION_VERSION;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.propertyNames = {
      ...DEFAULT_PROPERTIES,
      ...config.propertyNames,
    };
  }

  async listPages(): Promise<NotionWorkItemPage[]> {
    await this.ensureSchema();

    const pages: NotionPage[] = [];
    let cursor: string | undefined;
    do {
      const response = await this.request<NotionQueryResponse>(
        `/data_sources/${this.config.dataSourceId}/query`,
        {
          method: "POST",
          body: {
            page_size: 100,
            start_cursor: cursor,
          },
        }
      );
      pages.push(...(response.results ?? []));
      cursor = response.has_more
        ? (response.next_cursor ?? undefined)
        : undefined;
    } while (cursor);

    return pages.map((page) => this.pageToMirrorPage(page));
  }

  hashItem(item: WorkItem): string {
    return sha256(normalizeEditable(editableFromItem(item)));
  }

  hashPage(page: NotionWorkItemPage): string {
    return sha256(normalizeEditable(page.editable));
  }

  patchFromPage(page: NotionWorkItemPage, item: WorkItem): WorkItemNotionPatch {
    const patch: WorkItemNotionPatch = {};
    const editable = page.editable;

    setIfStringChanged(patch, "title", editable.title, item.title);
    setIfStringChanged(patch, "status", editable.status, item.status);
    setIfStringChanged(patch, "node", editable.node, item.node);
    setIfNumberChanged(patch, "priority", editable.priority, item.priority);
    setIfNumberChanged(patch, "rank", editable.rank, item.rank);
    setIfNumberChanged(patch, "estimate", editable.estimate, item.estimate);
    setIfStringChanged(patch, "summary", editable.summary, item.summary);
    setIfStringChanged(patch, "outcome", editable.outcome, item.outcome);
    setIfStringChanged(patch, "branch", editable.branch, item.branch);
    setIfStringChanged(patch, "pr", editable.pr, item.pr);
    setIfStringChanged(patch, "reviewer", editable.reviewer, item.reviewer);
    if (
      editable.labels &&
      differs(sortedStrings(editable.labels), sortedStrings(item.labels))
    ) {
      patch.labels = editable.labels;
    }

    return patch;
  }

  async upsertItem(
    item: WorkItem,
    options: {
      pageId?: string;
      syncState?: string;
      syncError?: string;
    } = {}
  ): Promise<NotionUpsertResult> {
    await this.ensureSchema();

    const properties = await this.buildPropertiesForItem(item, {
      syncState: options.syncState ?? "synced",
      syncError: options.syncError ?? "",
      lastSyncedAt: new Date().toISOString(),
    });

    if (options.pageId) {
      const page = await this.request<NotionPage>(`/pages/${options.pageId}`, {
        method: "PATCH",
        body: { properties },
      });
      return { pageId: page.id, action: "updated" };
    }

    const page = await this.request<NotionPage>("/pages", {
      method: "POST",
      body: {
        parent: { data_source_id: this.config.dataSourceId },
        properties,
      },
    });
    return { pageId: page.id, action: "created" };
  }

  async markConflict(page: NotionWorkItemPage, message: string): Promise<void> {
    await this.updatePageMetadata(page.pageId, {
      syncState: "conflict",
      syncError: message,
    });
  }

  async markError(page: NotionWorkItemPage, message: string): Promise<void> {
    await this.updatePageMetadata(page.pageId, {
      syncState: "error",
      syncError: message,
    });
  }

  private async updatePageMetadata(
    pageId: string,
    input: { syncState?: string; syncError?: string }
  ): Promise<void> {
    await this.ensureSchema();
    const properties: Record<string, unknown> = {};
    await this.addProperty(properties, "syncState", input.syncState);
    await this.addProperty(properties, "syncError", input.syncError);
    await this.addProperty(
      properties,
      "lastSyncedAt",
      new Date().toISOString()
    );

    await this.request<NotionPage>(`/pages/${pageId}`, {
      method: "PATCH",
      body: { properties },
    });
  }

  private pageToMirrorPage(page: NotionPage): NotionWorkItemPage {
    const prop = (key: PropertyKey) => page.properties[this.propertyNames[key]];
    const rawId = textFromProperty(prop("id")).trim();
    const rawStatus = textFromProperty(prop("status")).trim();
    const status = asStatus(rawStatus);
    const validationErrors =
      rawStatus && !status ? [invalidStatusMessage(rawStatus)] : [];

    const editable = normalizeEditable({
      title: textFromProperty(prop("title")).trim() || undefined,
      status,
      node: textFromProperty(prop("node")).trim() || undefined,
      priority: numberFromProperty(prop("priority")),
      rank: numberFromProperty(prop("rank")),
      estimate: numberFromProperty(prop("estimate")),
      summary: textFromProperty(prop("summary")).trim() || undefined,
      outcome: textFromProperty(prop("outcome")).trim() || undefined,
      labels: stringArrayFromProperty(prop("labels")),
      branch: textFromProperty(prop("branch")).trim() || undefined,
      pr: textFromProperty(prop("pr")).trim() || undefined,
      reviewer: textFromProperty(prop("reviewer")).trim() || undefined,
    });

    return {
      pageId: page.id,
      lastEditedTime: page.last_edited_time,
      url: page.url,
      cogniId: rawId ? toWorkItemId(rawId) : undefined,
      cogniRevision: numberFromProperty(prop("cogniRevision")),
      syncHash: textFromProperty(prop("syncHash")).trim() || undefined,
      syncState: textFromProperty(prop("syncState")).trim() || undefined,
      syncError: textFromProperty(prop("syncError")).trim() || undefined,
      validationErrors,
      editable,
    };
  }

  private async buildPropertiesForItem(
    item: WorkItem,
    metadata: {
      syncState: string;
      syncError: string;
      lastSyncedAt: string;
    }
  ): Promise<Record<string, unknown>> {
    const properties: Record<string, unknown> = {};
    await this.addProperty(properties, "title", item.title);
    await this.addProperty(properties, "id", String(item.id));
    await this.addProperty(properties, "type", item.type);
    await this.addStatusProperty(properties, item.status);
    await this.addProperty(properties, "node", item.node);
    await this.addProperty(properties, "priority", item.priority);
    await this.addProperty(properties, "rank", item.rank);
    await this.addProperty(properties, "estimate", item.estimate);
    await this.addProperty(properties, "summary", item.summary ?? "");
    await this.addProperty(properties, "outcome", item.outcome ?? "");
    await this.addProperty(properties, "labels", [...item.labels]);
    await this.addProperty(properties, "branch", item.branch ?? "");
    await this.addProperty(properties, "pr", item.pr ?? "");
    await this.addProperty(properties, "reviewer", item.reviewer ?? "");
    await this.addProperty(properties, "cogniRevision", item.revision);
    await this.addProperty(properties, "syncHash", this.hashItem(item));
    await this.addProperty(properties, "syncState", metadata.syncState);
    await this.addProperty(properties, "syncError", metadata.syncError);
    await this.addProperty(properties, "lastSyncedAt", metadata.lastSyncedAt);
    return properties;
  }

  private async addProperty(
    target: Record<string, unknown>,
    key: PropertyKey,
    value: number | string | string[] | undefined
  ): Promise<void> {
    const schema = await this.ensureSchema();
    const name = this.propertyNames[key];
    const propertyType = schema.properties[name]?.type as
      | PropertyType
      | undefined;
    if (!propertyType) return;

    target[name] = propertyPayload(propertyType, value);
  }

  private async addStatusProperty(
    target: Record<string, unknown>,
    status: WorkItemStatus
  ): Promise<void> {
    const schema = await this.ensureSchema();
    const name = this.propertyNames.status;
    const propertyType = schema.properties[name]?.type as
      | PropertyType
      | undefined;
    if (!propertyType) return;

    target[name] = propertyPayload(
      propertyType,
      propertyType === "status" ? notionStatusName(status) : status
    );
  }

  private async ensureSchema(): Promise<NotionDataSource> {
    this.schemaPromise ??= this.loadSchema();
    return this.schemaPromise;
  }

  private async loadSchema(): Promise<NotionDataSource> {
    const dataSource = await this.request<NotionDataSource>(
      `/data_sources/${this.config.dataSourceId}`
    );

    const titleProperty = dataSource.properties[this.propertyNames.title];
    const idProperty = dataSource.properties[this.propertyNames.id];
    if (titleProperty?.type !== "title") {
      throw new Error(
        `Notion property "${this.propertyNames.title}" must be a title property`
      );
    }
    if (
      !idProperty ||
      (idProperty.type !== "rich_text" && idProperty.type !== "title")
    ) {
      throw new Error(
        `Notion property "${this.propertyNames.id}" must be a rich_text or title property`
      );
    }

    return dataSource;
  }

  private async request<T>(
    pathname: string,
    init?: { method?: string; body?: Record<string, unknown> }
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.config.authToken}`,
        "Content-Type": "application/json",
        "Notion-Version": this.notionVersion,
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Notion API ${init?.method ?? "GET"} ${pathname} failed: ${response.status} ${text}`
      );
    }

    return (await response.json()) as T;
  }
}

export function isKnownWorkItemType(value: string): value is WorkItemType {
  return asType(value) !== undefined;
}
