---
id: guide.notion-work-items-connection
type: guide
title: Notion Work Items Connection
status: draft
trust: draft
summary: Connect a personal Notion data source to the Cogni work-item mirror prototype.
read_when: Setting WORK_ITEMS_NOTION_TOKEN or WORK_ITEMS_NOTION_DATA_SOURCE_ID for the Notion work-item mirror.
owner: derekg1729
created: 2026-05-01
verified: 2026-05-01
tags: [notion, work-items, candidate-a]
---

# Notion Work Items Connection

This prototype treats Notion as a view/edit mirror of Cogni work items. Cogni/Dolt remains the source of truth. Notion pages are keyed by the exact Cogni work item ID in the `Cogni ID` property.

Design reference: [Notion Work Items Bridge](../spec/notion-work-items-bridge.md).

## Preferred Interaction Style

Keep the human loop simple:

- Human clicks links, presses Notion buttons, and pastes/copies obvious values.
- Human writes discovered values into `.env.cogni` as handoff state.
- Assistant reads `.env.cogni`, calls APIs, resolves IDs, patches machine-editable schema, and reports the next exact link/button for the human.
- Do not ask humans to run `curl`, inspect JSON, or distinguish Notion page/database/data source IDs by hand.

## Human Steps

Humans should not call the Notion API. Humans click through Notion permissions and add env values as they discover them. `.env.cogni` is the handoff between the human and the assistant.

1. Create a connection at <https://www.notion.so/profile/integrations/>.
2. Copy the `Installation access token` into `.env.cogni`:

```bash
WORK_ITEMS_NOTION_TOKEN=secret_...
```

3. Open the Notion page that should contain the controlled Cogni work-item view, for example a `Domains` page.
4. Inside that page, create a database/table for the work-item mirror.
5. Open that database/table as a full page.
6. Press the top-right `...` menu.
7. Press `Add connections` or `Connections`.
8. Select the new connection.
9. Copy the browser URL into `.env.cogni` as the next handoff value:

```bash
WORK_ITEMS_NOTION_ROOT_URL=https://www.notion.so/Cogni-Dev-353fbc99d0a780db9176e8f6e8cd55a0
```

10. Tell the assistant to resolve and verify the Notion IDs.

Important: add the connection to the database/table itself, not only to one row/page inside the table. If the assistant can read one row but gets `Could not find database`, the connection was added at the wrong level.

Treat the copied URL as the whole Notion surface being controlled. The assistant will resolve whether it is a database URL, data-source view URL, or a page inside the database, then store the exact machine IDs in `.env.cogni`.

For the current `Cogni-Dev` URL:

```text
https://www.notion.so/Cogni-Dev-353fbc99d0a780db9176e8f6e8cd55a0
```

That URL is a row/page inside the table. If possible, click the parent database/table from the breadcrumb at the top of Notion, then press `...` -> `Add connections` there.

The parent database ID currently reported by Notion is:

```text
353fbc99d0a7808fb2b4dc90de2004d7
```

This direct parent link may open the database/table:

<https://www.notion.so/353fbc99d0a7808fb2b4dc90de2004d7>

## Required Properties

Minimum required properties:

| Property   | Notion type   |
| ---------- | ------------- |
| `Name`     | Title         |
| `Cogni ID` | Text or Title |

Recommended mirror properties:

| Property         | Notion type             |
| ---------------- | ----------------------- |
| `Type`           | Select                  |
| `Status`         | Select preferred        |
| `Node`           | Text or Select          |
| `Priority`       | Number                  |
| `Rank`           | Number                  |
| `Estimate`       | Number                  |
| `Summary`        | Text                    |
| `Outcome`        | Text                    |
| `Labels`         | Multi-select            |
| `Branch`         | Text                    |
| `PR`             | URL or Text             |
| `Reviewer`       | Text                    |
| `Cogni Revision` | Number                  |
| `Sync Hash`      | Text                    |
| `Sync State`     | Status, Select, or Text |
| `Sync Error`     | Text                    |
| `Last Synced At` | Date                    |

## Editing From Notion

Editable fields flow back to Cogni on the next sync pass. The prototype is not continuous yet; it syncs when the internal candidate-a endpoint is called.

`Status` must use exact Cogni lifecycle values. Prefer a Notion `Select` property with exactly these options:

- `needs_triage`
- `needs_research`
- `needs_design`
- `needs_implement`
- `needs_closeout`
- `needs_merge`
- `done`
- `blocked`
- `cancelled`

Notion's default `Not started` and `In progress` labels are UI defaults, not Cogni lifecycle statuses. In the current prototype they are rejected for write-back: sync marks the row `Sync State = error` and leaves Cogni unchanged.

`Done` is the only display exception when using Notion's special `Status` property, because Notion treats `done` and `Done` as the same status label. For exact string matching including lowercase `done`, use a plain Notion `Select` property instead of the special `Status` property.

## Assistant Steps

The assistant reads `.env.cogni`, resolves API IDs from `WORK_ITEMS_NOTION_ROOT_URL`, and writes intermediate IDs back to `.env.cogni`.

First extract the URL/page ID into a helper value:

```bash
WORK_ITEMS_NOTION_ROOT_PAGE_ID=353fbc99d0a780db9176e8f6e8cd55a0
```

`WORK_ITEMS_NOTION_ROOT_URL` and `WORK_ITEMS_NOTION_ROOT_PAGE_ID` are not required by the app. They are breadcrumbs for assistant setup when the human gives a row/page URL.

The assistant can retrieve the page and read its parent:

```bash
curl -sS "https://api.notion.com/v1/pages/$WORK_ITEMS_NOTION_ROOT_PAGE_ID" \
  -H "Authorization: Bearer $WORK_ITEMS_NOTION_TOKEN" \
  -H "Notion-Version: ${WORK_ITEMS_NOTION_VERSION:-2026-03-11}" \
  | jq '.parent'
```

For the current `Cogni-Dev` URL, Notion reports:

```bash
WORK_ITEMS_NOTION_DATA_SOURCE_ID=353fbc99-d0a7-807d-9064-000b8708886a
WORK_ITEMS_NOTION_DATABASE_ID=353fbc99-d0a7-808f-b2b4-dc90de2004d7
```

The app needs `WORK_ITEMS_NOTION_DATA_SOURCE_ID`. `WORK_ITEMS_NOTION_DATABASE_ID` is only a debugging breadcrumb.

The assistant should verify the data source:

```bash
curl -sS "https://api.notion.com/v1/data_sources/$WORK_ITEMS_NOTION_DATA_SOURCE_ID" \
  -H "Authorization: Bearer $WORK_ITEMS_NOTION_TOKEN" \
  -H "Notion-Version: ${WORK_ITEMS_NOTION_VERSION:-2026-03-11}" \
  | jq '{id, object, properties: (.properties | keys)}'
```

Expected:

- `object` is `data_source`.
- `properties` includes at least `Name` and `Cogni ID`.

If this returns `Could not find database`, the assistant should still write the discovered IDs into `.env.cogni`, then hand back the parent table link to the human so they can add the connection at the right level.

## Local Env

`.env.cogni` evolves through the setup. Intermediate values are useful; keep them.

```bash
# Human adds this first:
WORK_ITEMS_NOTION_TOKEN=secret_...

# Human adds this after opening/copying the Notion URL:
WORK_ITEMS_NOTION_ROOT_URL=https://www.notion.so/Cogni-Dev-353fbc99d0a780db9176e8f6e8cd55a0

# Assistant derives these from the URL/API:
WORK_ITEMS_NOTION_ROOT_PAGE_ID=353fbc99d0a780db9176e8f6e8cd55a0
WORK_ITEMS_NOTION_DATA_SOURCE_ID=353fbc99-d0a7-807d-9064-000b8708886a
WORK_ITEMS_NOTION_DATABASE_ID=353fbc99-d0a7-808f-b2b4-dc90de2004d7

# Optional. The prototype defaults to 2025-09-03.
WORK_ITEMS_NOTION_VERSION=2026-03-11
```

Only `WORK_ITEMS_NOTION_TOKEN` and `WORK_ITEMS_NOTION_DATA_SOURCE_ID` are required by the app. The URL/page/database values are setup breadcrumbs that let an assistant resume without asking the human to re-copy Notion details.
