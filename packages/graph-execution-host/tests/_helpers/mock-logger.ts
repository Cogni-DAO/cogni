// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/graph-execution-host/tests/_helpers/mock-logger`
 * Purpose: Test double for LoggerPort.
 * Scope: Creates mock logger for decorator unit tests. Does not test production code.
 * Invariants: none
 * Side-effects: none
 * Links: src/ports/logger.port.ts
 * @internal
 */

import type { LoggerPort } from "../../src/ports/logger.port";

export function createMockLogger(): LoggerPort {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}
