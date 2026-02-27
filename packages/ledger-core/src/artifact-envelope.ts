// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core/artifact-envelope`
 * Purpose: Metadata and hashing validation for artifact envelopes. Does NOT standardize payload shape — payload is per-plugin and opaque to the pipeline.
 * Scope: Pure validation functions. Does not perform I/O.
 * Invariants:
 * - ARTIFACT_REF_NAMESPACED: artifactRef must match `namespace.name.vN` pattern.
 * - HASH_HEX_64: inputsHash and payloadHash must be 64-char lowercase hex (SHA-256).
 * Side-effects: none
 * Links: work/items/task.0113.epoch-artifact-pipeline.md
 * @public
 */

const ARTIFACT_REF_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*\.v\d+$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Validate that an artifactRef matches the required namespaced pattern.
 * Pattern: `namespace.name.vN` (e.g. `cogni.echo.v0`, `cogni.work_item_links.v0`)
 *
 * @throws Error if artifactRef is invalid
 */
export function validateArtifactRef(artifactRef: string): void {
  if (!artifactRef || !ARTIFACT_REF_PATTERN.test(artifactRef)) {
    throw new Error(
      `Invalid artifactRef '${artifactRef}': must match pattern 'namespace.name.vN' (e.g. 'cogni.echo.v0')`
    );
  }
}

/**
 * Validate an artifact envelope's metadata and hashes.
 * Does NOT validate payload shape — that is per-plugin.
 *
 * @throws Error if any field is invalid
 */
export function validateArtifactEnvelope(params: {
  artifactRef: string;
  algoRef: string;
  inputsHash: string;
  payloadHash: string;
  payloadJson: Record<string, unknown>;
}): void {
  validateArtifactRef(params.artifactRef);

  if (!params.algoRef || params.algoRef.trim().length === 0) {
    throw new Error("Invalid algoRef: must be a non-empty string");
  }

  if (!SHA256_HEX_PATTERN.test(params.inputsHash)) {
    throw new Error(
      `Invalid inputsHash '${params.inputsHash}': must be 64-char lowercase hex (SHA-256)`
    );
  }

  if (!SHA256_HEX_PATTERN.test(params.payloadHash)) {
    throw new Error(
      `Invalid payloadHash '${params.payloadHash}': must be 64-char lowercase hex (SHA-256)`
    );
  }

  if (
    params.payloadJson === null ||
    params.payloadJson === undefined ||
    typeof params.payloadJson !== "object" ||
    Array.isArray(params.payloadJson)
  ) {
    throw new Error("Invalid payloadJson: must be a non-null object");
  }
}
