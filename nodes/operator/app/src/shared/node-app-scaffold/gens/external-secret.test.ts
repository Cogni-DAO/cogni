// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/node-app-scaffold/gens/external-secret.test`
 * Purpose: Pin node-birth ExternalSecret rendering for formation PRs.
 * Scope: Pure renderer tests; does not read files or invoke Kubernetes.
 * Side-effects: none
 * Links: external-secret.ts, docs/spec/node-ci-cd-contract.md
 * @internal
 */

import { describe, expect, it } from "vitest";
import {
  renderExternalSecret,
  renderExternalSecretKustomization,
} from "./external-secret";

describe("renderExternalSecret", () => {
  it("renders a per-env node-app secret leaf backed by the node OpenBao path", () => {
    expect(renderExternalSecret("creative", "candidate-a")).toContain(
      [
        "kind: ExternalSecret",
        "metadata:",
        "  name: node-app-secrets",
        "  namespace: cogni-candidate-a",
        "    app.kubernetes.io/component: creative",
        "  target:",
        "    name: creative-node-app-secrets",
        "        key: candidate-a/creative",
      ].join("\n")
    );
  });
});

describe("renderExternalSecretKustomization", () => {
  it("renders the leaf kustomization", () => {
    expect(renderExternalSecretKustomization()).toContain(
      ["kind: Kustomization", "resources:", "  - external-secret.yaml"].join(
        "\n"
      )
    );
  });
});
