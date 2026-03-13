// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-core/tooling/ports/artifact-sink.port`
 * Purpose: Port interface for writing non-text artifacts (images, audio, files) to durable storage.
 * Scope: Defines ArtifactSinkPort for abstracting artifact persistence. Does NOT import storage implementations.
 * Invariants:
 *   - ARTIFACT_BYTES_NEVER_IN_STATE: Raw bytes go to sink, only ArtifactRef travels in run payloads
 *   - SINK_RETURNS_REF: write() returns ArtifactRef for inclusion in GraphResult/GraphFinal
 * Side-effects: none (types only)
 * Links: task.0163
 * @public
 */

import type { ArtifactRef } from "../types";

/**
 * Port interface for writing artifacts to durable storage.
 *
 * Implementations may write to:
 * - Local filesystem (dev)
 * - S3/R2 (production)
 * - In-memory buffer (testing)
 *
 * Per ARTIFACT_BYTES_NEVER_IN_STATE: tool outputs with raw bytes
 * (e.g., base64 images) write bytes here and receive an ArtifactRef
 * that is safe to carry in GraphResult/GraphFinal payloads.
 */
export interface ArtifactSinkPort {
  /**
   * Write artifact bytes to durable storage.
   *
   * @param params - Artifact write parameters
   * @returns ArtifactRef with storage metadata (no raw bytes)
   */
  write(params: ArtifactWriteParams): Promise<ArtifactRef>;
}

/**
 * Parameters for writing an artifact to the sink.
 */
export interface ArtifactWriteParams {
  /** Artifact kind (e.g., "image", "audio", "file") */
  readonly type: string;
  /** Raw bytes as a Buffer */
  readonly data: Buffer;
  /** MIME type (e.g., "image/png") */
  readonly mimeType: string;
  /** Tool call ID that produced this artifact */
  readonly toolCallId: string;
  /** Optional metadata to attach to the artifact ref */
  readonly metadata?: Record<string, unknown>;
}
