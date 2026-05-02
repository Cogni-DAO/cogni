// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/work-items/tests/adapters/notion`
 * Purpose: Unit tests for the Notion work-item mirror boundary mapping.
 * Scope: Fake Notion HTTP responses only; does not hit the network or app container.
 * Invariants: Notion status labels must map to the Cogni lifecycle enum exactly.
 * Side-effects: none
 * Links: docs/spec/work-items-port.md
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  isKnownWorkItemType,
  NotionWorkItemMirror,
} from "../../src/adapters/notion/mirror.js";
import { toWorkItemId, type WorkItem } from "../../src/types.js";

function textProperty(value: string): unknown {
  return { type: "rich_text", rich_text: [{ plain_text: value }] };
}

function titleProperty(value: string): unknown {
  return { type: "title", title: [{ plain_text: value }] };
}

function statusProperty(value: string): unknown {
  return { type: "status", status: { name: value } };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("NotionWorkItemMirror", () => {
  const baseItem: WorkItem = {
    id: toWorkItemId("task.5067"),
    type: "task",
    title: "Create Grafana Cloud P0 alert rules",
    status: "done",
    node: "operator",
    assignees: [],
    externalRefs: [],
    actor: "ai",
    labels: [],
    specRefs: [],
    revision: 1,
    deployVerified: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };

  it("marks non-Cogni Notion status labels as validation errors", async () => {
    const mirror = new NotionWorkItemMirror({
      authToken: "secret_test",
      dataSourceId: "source_test",
      fetch: async (url) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/v1/data_sources/source_test") {
          return jsonResponse({
            object: "data_source",
            id: "source_test",
            properties: {
              Name: { type: "title" },
              "Cogni ID": { type: "rich_text" },
              Status: { type: "status" },
              "Sync Hash": { type: "rich_text" },
            },
          });
        }
        if (pathname === "/v1/data_sources/source_test/query") {
          return jsonResponse({
            results: [
              {
                object: "page",
                id: "page_test",
                created_time: "2026-05-01T00:00:00.000Z",
                last_edited_time: "2026-05-01T00:00:00.000Z",
                properties: {
                  Name: titleProperty("Human-facing item"),
                  "Cogni ID": textProperty("task.5067"),
                  Status: statusProperty("In progress"),
                  "Sync Hash": textProperty("abc123"),
                },
              },
            ],
            has_more: false,
          });
        }
        throw new Error(`Unexpected request: ${pathname}`);
      },
    });

    const pages = await mirror.listPages();

    expect(pages).toHaveLength(1);
    expect(pages[0]?.editable.status).toBeUndefined();
    expect(pages[0]?.validationErrors).toEqual([
      'Invalid Notion Status "In progress". Use exact Cogni lifecycle status: needs_triage, needs_research, needs_design, needs_implement, needs_closeout, needs_merge, done, blocked, cancelled.',
    ]);
  });

  it("accepts exact Cogni lifecycle status labels", async () => {
    const mirror = new NotionWorkItemMirror({
      authToken: "secret_test",
      dataSourceId: "source_test",
      fetch: async (url) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/v1/data_sources/source_test") {
          return jsonResponse({
            object: "data_source",
            id: "source_test",
            properties: {
              Name: { type: "title" },
              "Cogni ID": { type: "rich_text" },
              Status: { type: "status" },
              "Sync Hash": { type: "rich_text" },
            },
          });
        }
        if (pathname === "/v1/data_sources/source_test/query") {
          return jsonResponse({
            results: [
              {
                object: "page",
                id: "page_test",
                created_time: "2026-05-01T00:00:00.000Z",
                last_edited_time: "2026-05-01T00:00:00.000Z",
                properties: {
                  Name: titleProperty("Agent-ready item"),
                  "Cogni ID": textProperty("task.5067"),
                  Status: statusProperty("needs_implement"),
                  "Sync Hash": textProperty("abc123"),
                },
              },
            ],
            has_more: false,
          });
        }
        throw new Error(`Unexpected request: ${pathname}`);
      },
    });

    const pages = await mirror.listPages();

    expect(pages[0]?.editable.status).toBe("needs_implement");
    expect(pages[0]?.validationErrors).toEqual([]);
  });

  it("writes lowercase done when Status is a Select property", async () => {
    let patchedBody: unknown;
    const mirror = new NotionWorkItemMirror({
      authToken: "secret_test",
      dataSourceId: "source_test",
      fetch: async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/v1/data_sources/source_test") {
          return jsonResponse({
            object: "data_source",
            id: "source_test",
            properties: {
              Name: { type: "title" },
              "Cogni ID": { type: "rich_text" },
              Type: { type: "select" },
              Status: { type: "select" },
              Node: { type: "rich_text" },
              Labels: { type: "multi_select" },
              "Cogni Revision": { type: "number" },
              "Sync Hash": { type: "rich_text" },
              "Sync State": { type: "status" },
              "Sync Error": { type: "rich_text" },
              "Last Synced At": { type: "date" },
            },
          });
        }
        if (pathname === "/v1/pages/page_test") {
          patchedBody = JSON.parse(String(init?.body));
          return jsonResponse({
            object: "page",
            id: "page_test",
            created_time: "2026-05-01T00:00:00.000Z",
            last_edited_time: "2026-05-01T00:00:00.000Z",
            properties: {},
          });
        }
        throw new Error(`Unexpected request: ${pathname}`);
      },
    });

    await mirror.upsertItem(baseItem, { pageId: "page_test" });

    expect(patchedBody).toMatchObject({
      properties: {
        Status: { select: { name: "done" } },
      },
    });
  });

  it("paginates Notion pages and creates new pages under the data source", async () => {
    const requests: Array<{ pathname: string; body?: unknown }> = [];
    let createdBody: unknown;
    const mirror = new NotionWorkItemMirror({
      authToken: "secret_test",
      dataSourceId: "source_test",
      fetch: async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ pathname, body });

        if (pathname === "/v1/data_sources/source_test") {
          return jsonResponse({
            object: "data_source",
            id: "source_test",
            properties: {
              Name: { type: "title" },
              "Cogni ID": { type: "rich_text" },
              Type: { type: "select" },
              Status: { type: "status" },
              Node: { type: "rich_text" },
              Labels: { type: "multi_select" },
              "Cogni Revision": { type: "number" },
              "Sync Hash": { type: "rich_text" },
              "Sync State": { type: "status" },
              "Sync Error": { type: "rich_text" },
              "Last Synced At": { type: "date" },
            },
          });
        }
        if (
          pathname === "/v1/data_sources/source_test/query" &&
          body?.start_cursor === undefined
        ) {
          return jsonResponse({
            results: [
              {
                object: "page",
                id: "page_one",
                created_time: "2026-05-01T00:00:00.000Z",
                last_edited_time: "2026-05-01T00:00:00.000Z",
                properties: {
                  Name: titleProperty("First page"),
                  "Cogni ID": textProperty("task.5067"),
                  Status: statusProperty("needs_triage"),
                },
              },
            ],
            has_more: true,
            next_cursor: "cursor_two",
          });
        }
        if (
          pathname === "/v1/data_sources/source_test/query" &&
          body?.start_cursor === "cursor_two"
        ) {
          return jsonResponse({
            results: [
              {
                object: "page",
                id: "page_two",
                created_time: "2026-05-01T00:00:00.000Z",
                last_edited_time: "2026-05-01T00:00:00.000Z",
                properties: {
                  Name: titleProperty("Second page"),
                  "Cogni ID": textProperty("task.5059"),
                  Status: statusProperty("blocked"),
                },
              },
            ],
            has_more: false,
          });
        }
        if (pathname === "/v1/pages") {
          createdBody = body;
          return jsonResponse({
            object: "page",
            id: "page_created",
            created_time: "2026-05-01T00:00:00.000Z",
            last_edited_time: "2026-05-01T00:00:00.000Z",
            properties: {},
          });
        }
        throw new Error(`Unexpected request: ${pathname}`);
      },
    });

    const pages = await mirror.listPages();
    const result = await mirror.upsertItem(baseItem);

    expect(pages.map((page) => String(page.cogniId))).toEqual([
      "task.5067",
      "task.5059",
    ]);
    expect(
      requests.filter((req) => req.pathname.endsWith("/query"))
    ).toHaveLength(2);
    expect(result).toEqual({ pageId: "page_created", action: "created" });
    expect(createdBody).toMatchObject({
      parent: { data_source_id: "source_test" },
      properties: {
        Name: { title: [{ text: { content: baseItem.title } }] },
        Status: { status: { name: "Done" } },
        "Sync State": { status: { name: "synced" } },
      },
    });
  });

  it("marks page metadata for conflicts and errors", async () => {
    const patches: unknown[] = [];
    const mirror = new NotionWorkItemMirror({
      authToken: "secret_test",
      dataSourceId: "source_test",
      fetch: async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/v1/data_sources/source_test") {
          return jsonResponse({
            object: "data_source",
            id: "source_test",
            properties: {
              Name: { type: "title" },
              "Cogni ID": { type: "rich_text" },
              "Sync State": { type: "status" },
              "Sync Error": { type: "rich_text" },
              "Last Synced At": { type: "date" },
            },
          });
        }
        if (pathname === "/v1/pages/page_test") {
          patches.push(JSON.parse(String(init?.body)));
          return jsonResponse({
            object: "page",
            id: "page_test",
            created_time: "2026-05-01T00:00:00.000Z",
            last_edited_time: "2026-05-01T00:00:00.000Z",
            properties: {},
          });
        }
        throw new Error(`Unexpected request: ${pathname}`);
      },
    });

    await mirror.markConflict(
      {
        pageId: "page_test",
        lastEditedTime: "2026-05-01T00:00:00.000Z",
        validationErrors: [],
        editable: {},
      },
      "conflict message"
    );
    await mirror.markError(
      {
        pageId: "page_test",
        lastEditedTime: "2026-05-01T00:00:00.000Z",
        validationErrors: [],
        editable: {},
      },
      "error message"
    );

    expect(patches).toHaveLength(2);
    expect(patches[0]).toMatchObject({
      properties: {
        "Sync State": { status: { name: "conflict" } },
        "Sync Error": {
          rich_text: [{ text: { content: "conflict message" } }],
        },
      },
    });
    expect(patches[1]).toMatchObject({
      properties: {
        "Sync State": { status: { name: "error" } },
        "Sync Error": { rich_text: [{ text: { content: "error message" } }] },
      },
    });
  });

  it("builds a patch from changed editable Notion fields", () => {
    const mirror = new NotionWorkItemMirror({
      authToken: "secret_test",
      dataSourceId: "source_test",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
    });

    const patch = mirror.patchFromPage(
      {
        pageId: "page_test",
        lastEditedTime: "2026-05-01T00:00:00.000Z",
        validationErrors: [],
        editable: {
          title: "Updated title",
          status: "blocked",
          node: "operator",
          priority: 1,
          rank: 2,
          estimate: 3,
          summary: "Updated summary",
          outcome: "Updated outcome",
          labels: ["b", "a"],
          branch: "feature/notion",
          pr: "1177",
          reviewer: "agent",
        },
      },
      baseItem
    );

    expect(patch).toEqual({
      title: "Updated title",
      status: "blocked",
      priority: 1,
      rank: 2,
      estimate: 3,
      summary: "Updated summary",
      outcome: "Updated outcome",
      labels: ["b", "a"],
      branch: "feature/notion",
      pr: "1177",
      reviewer: "agent",
    });
  });

  it("rejects invalid data source schemas and failed Notion requests", async () => {
    const invalidSchemaMirror = new NotionWorkItemMirror({
      authToken: "secret_test",
      dataSourceId: "source_test",
      fetch: async () =>
        jsonResponse({
          object: "data_source",
          id: "source_test",
          properties: {
            Name: { type: "rich_text" },
            "Cogni ID": { type: "rich_text" },
          },
        }),
    });

    await expect(invalidSchemaMirror.listPages()).rejects.toThrow(
      'Notion property "Name" must be a title property'
    );

    const failedRequestMirror = new NotionWorkItemMirror({
      authToken: "secret_test",
      dataSourceId: "source_test",
      fetch: async () =>
        new Response("no access", {
          status: 403,
        }),
    });

    await expect(failedRequestMirror.listPages()).rejects.toThrow(
      "Notion API GET /data_sources/source_test failed: 403 no access"
    );
  });

  it("identifies known Cogni work item types", () => {
    expect(isKnownWorkItemType("task")).toBe(true);
    expect(isKnownWorkItemType("bug")).toBe(true);
    expect(isKnownWorkItemType("epic")).toBe(false);
  });
});
