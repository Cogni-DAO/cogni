// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/dns-ops/tests/fixtures`
 * Purpose: Shared test constants for dns-ops unit tests. Does NOT contain test logic.
 * Scope: Test fixtures only. Does NOT export runtime code.
 * Invariants: All IPs are RFC 5737 TEST-NET addresses — never routed on the public internet.
 * Side-effects: none
 * Links: https://datatracker.ietf.org/doc/html/rfc5737
 * @internal
 */

/** RFC 5737 TEST-NET-1: reserved for documentation/examples, never routed */
export const TEST_IP_1 = "192.0.2.1";
/** RFC 5737 TEST-NET-1 */
export const TEST_IP_2 = "192.0.2.2";
/** RFC 5737 TEST-NET-2 */
export const TEST_IP_3 = "198.51.100.1";
/** RFC 5737 TEST-NET-3 */
export const TEST_IP_4 = "203.0.113.1";

/** RFC 2606 reserved domain — safe for tests */
export const TEST_DOMAIN = "example.test";

/** Loopback — standard for test client IPs */
export const TEST_CLIENT_IP = "127.0.0.1";
