// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(public)/internship/page`
 * Purpose: Public internship recruitment landing page hosted by the operator app.
 * Scope: Renders the internship landing surface; signup posts to the public interest API.
 * Invariants: Does not replace the operator homepage; remains reachable as a standalone public page.
 * Side-effects: none
 * Links: story.5001, src/features/home/components/InternshipHome.tsx
 * @public
 */

import type { ReactElement } from "react";

import { InternshipHome } from "@/features/home/components/InternshipHome";

export default function InternshipPage(): ReactElement {
  return <InternshipHome />;
}
