---
id: guide.new-node-styling
type: guide
title: New Node Styling Guide
status: draft
trust: draft
summary: How to customize branding, theming, and UI for a new Cogni node
read_when: Creating a new node or customizing an existing node's visual identity
owner: derekg1729
created: 2026-04-01
verified: null
tags: [nodes, styling, ui]
---

# New Node Styling Guide

Each Cogni node has its own visual identity while sharing a common layout.
Customization is done by editing 4 files in your node's `app/src/`.

## What to customize

### 1. Icon + Name (header + sidebar)

Each node uses a [Lucide icon](https://lucide.dev/icons) + `cogni/{name}` text.

**Files:**

- `src/features/layout/components/AppHeader.tsx` — public header
- `src/features/layout/components/AppSidebar.tsx` — signed-in sidebar

**Pattern** (from poly):

```tsx
import { Activity } from "lucide-react";

// In header/sidebar:
<Activity className="size-5 shrink-0 text-primary" />
<span className="font-bold">
  cogni<span className="text-primary">/poly</span>
</span>
```

**Examples:**

| Node     | Icon              | Import         |
| -------- | ----------------- | -------------- |
| Operator | `Brain`           | `lucide-react` |
| Poly     | `Activity`        | `lucide-react` |
| Resy     | `UtensilsCrossed` | `lucide-react` |

### 2. Theme colors (`tailwind.css`)

**File:** `src/styles/tailwind.css`

Set the `--primary` CSS variable in both `:root` (light) and `.dark` sections.
The accent gradient (`--accent-from`, `--accent-to`, `--accent-glow`) and sidebar
colors should use the same hue.

**Examples:**

| Node     | Hue        | `--primary` (dark) | Identity                           |
| -------- | ---------- | ------------------ | ---------------------------------- |
| Operator | 217 (blue) | `217 71% 40%`      | Default Cogni blue                 |
| Poly     | 160 (teal) | `160 65% 45%`      | Emerald/prediction                 |
| Resy     | 217 (blue) | `217 71% 40%`      | Same as operator (customize later) |

**Key variables to update** (search for the hue number, e.g. `217`):

```css
--primary: 160 65% 45%; /* main brand color */
--ring: 160 65% 45%; /* focus rings */
--sidebar-primary: 160 65% 45%; /* sidebar active item */
--sidebar-accent: 160 25% 17%; /* sidebar hover */
--sidebar-ring: 160 65% 45%; /* sidebar focus */
--accent-from: 164 75% 38%; /* gradient start */
--accent-to: 164 90% 55%; /* gradient end */
--accent-glow: 164 85% 45%; /* glow effects */
```

### 3. Metadata (`layout.tsx`)

**File:** `src/app/layout.tsx`

Update the `metadata` export:

```tsx
export const metadata: Metadata = {
  title: "Cogni Poly — Community AI Prediction Trading",
  description: "Your node description here.",
};
```

### 4. Homepage

**File:** `src/app/(public)/page.tsx`

The public landing page. Customize the hero, CTAs, and content.
Signed-in users redirect to `/chat`.

### 5. Chat suggested messages

**File:** `src/features/ai/components/ChatComposerExtras.tsx` (or equivalent)

Each node should tailor the chat welcome suggestions to its domain.
Operator shows generic prompts; poly should show prediction market prompts;
resy should show reservation prompts.

## Checklist for a new node

- [ ] Choose a Lucide icon — update `AppHeader.tsx` + `AppSidebar.tsx`
- [ ] Pick a primary hue — update `tailwind.css` (both `:root` and `.dark`)
- [ ] Set metadata — update `layout.tsx` title + description
- [ ] Customize homepage — edit `(public)/page.tsx`
- [ ] Customize chat suggestions — edit `ChatComposerExtras.tsx`
- [ ] Verify: `pnpm typecheck:{node-name}` passes
- [ ] Verify: dev server shows correct icon, colors, and name
