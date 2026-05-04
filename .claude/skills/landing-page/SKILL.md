---
name: landing-page
description: Use this skill whenever the user asks to create, refine, or spawn a lightweight public landing page in the operator Next.js app. It preserves `/` as the canonical operator homepage unless explicitly told otherwise, creates standalone public routes such as `/internship`, reuses the local UI kit and theme tokens, and adds a public form/API only when the page needs intake.
---

# Operator Landing Page Skill

Build public landing pages as standalone operator-hosted pages, not as replacements for the main homepage.

## First Decision

- If the user names a concrete campaign, cohort, product, or person, create that concrete public route (`/internship`, `/demo`, `/founder-name`).
- If the user says `/landing-page`, ask whether they mean a reusable agent skill/template or an actual public route before adding that route.
- Do not replace `nodes/operator/app/src/app/(public)/page.tsx` unless the user explicitly asks to redesign the main operator homepage.
- Treat the existing `/` page as a regression guard: visual changes to it need a stronger reason than a new campaign page.

## Default Shape

- Put the new page under `nodes/operator/app/src/app/(public)/<slug>/page.tsx`.
- Put non-trivial UI in a reusable component under `nodes/operator/app/src/features/home/components/` or a more specific feature folder.
- If the landing page needs intake, define the request/response shape in `nodes/operator/app/src/contracts/*.contract.ts` first, then add a public API route under `nodes/operator/app/src/app/api/v1/public/`.
- Use existing components from `@/components` and `@cogni/node-ui-kit`; do not invent a new design system.
- Keep copy specific to the page's user journey: the idea, the action, and the expected next step.

## Design Rules

- Match the existing Cogni operator palette, especially in dark mode.
- Use semantic Tailwind tokens for surfaces and text: `bg-background`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `ring`, and related token utilities.
- Do not use raw Tailwind colors (`stone`, `emerald`, arbitrary hex colors) in class names; the repo lint gate rejects them.
- If a page needs special light-mode treatment, scope CSS variables on the page root and apply them only in light mode via `next-themes`.
- Keep 3D/canvas visuals behind content, low enough contrast to remain decorative, and verify the canvas is nonblank with Playwright.
- Avoid harsh neutral bands, nested card stacks, and theme-breaking one-off colors.

## Route Contract

For a user request like “make an internship landing page,” use:

- Page route: `/internship`
- File: `nodes/operator/app/src/app/(public)/internship/page.tsx`
- Component: `InternshipHome` or another page-specific component
- Validation route: `/internship`, not `/`

For a user request like “create a reusable `/landing-page` template,” create a template/demo route only if they explicitly want the route itself. Otherwise treat `landing-page` as the agent skill/workflow and create the requested concrete route.

## Intake Rules

- Add intake only when the page needs signup, lead capture, waitlist, or contribution interest.
- Never log full emails, free-text notes, wallet addresses, or other sensitive fields. Prefer reference IDs, categories, lengths, and domains.
- Return a small confirmation state that includes a reference ID when useful.

## Validation

Run the narrowest checks that cover the change:

```bash
pnpm install --frozen-lockfile --offline
pnpm --filter operator typecheck
pnpm --filter operator lint
```

For visual pages, run a Playwright smoke that:

- Visits `/` and confirms the original homepage still renders when not intentionally changed.
- Visits the new public route and checks the H1.
- Captures desktop and mobile screenshots to `.context/`.
- If Three.js/canvas is used, reads pixels and confirms the canvas is nonblank.
- If intake exists, submits the form and confirms the success state.

## Work Item Validation Text

When updating the Cogni work item, name the concrete route:

```text
exercise: Visit `/<slug>`, confirm the landing page renders, submit the intake form if present, and receive the expected confirmation. Also visit `/` and confirm the normal operator homepage still renders.
observability: Query deployed logs for the route-specific structured event from the validation request.
```
