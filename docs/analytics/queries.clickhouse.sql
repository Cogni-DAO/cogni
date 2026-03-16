-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
-- SPDX-FileCopyrightText: 2025 Cogni-DAO

-- ============================================================================
-- PostHog ClickHouse Query Pack — High-Signal Analytics Queries
-- ============================================================================
--
-- Prerequisites:
--   1. PostHog self-hosted running with events ingested
--   2. Access to ClickHouse (docker exec or HTTP API)
--
-- How to run:
--   # Interactive CLI
--   docker exec -it posthog-clickhouse clickhouse-client
--
--   # Single query via HTTP
--   curl 'http://localhost:8123/' --data-binary @queries.clickhouse.sql
--
--   # Single query inline
--   docker exec posthog-clickhouse clickhouse-client \
--     --query "SELECT count() FROM posthog.events"
--
-- Schema discovery:
--   SHOW TABLES FROM posthog;
--   DESCRIBE posthog.events;
--
-- PostHog events table key columns:
--   event       — event name (e.g., 'cogni.auth.signed_in')
--   distinct_id — user identifier (our users.id UUID)
--   timestamp   — event timestamp
--   properties  — JSON string with event properties
--
-- Note: PostHog stores properties as a JSON string in ClickHouse.
-- Use JSONExtractString/JSONExtractFloat64/JSONExtractBool to extract values.
-- ============================================================================


-- ============================================================================
-- 1. ACTIVATION FUNNEL: signed_in → first agent.run_completed
-- ============================================================================
-- Shows conversion from sign-in to first successful agent run.
-- "Activated" = user who completed at least one agent run.

SELECT
    'Total signed in' AS stage,
    uniqExact(distinct_id) AS users
FROM posthog.events
WHERE event = 'cogni.auth.signed_in'
  AND timestamp >= now() - INTERVAL 30 DAY

UNION ALL

SELECT
    'First run completed' AS stage,
    uniqExact(distinct_id) AS users
FROM posthog.events
WHERE event = 'cogni.agent.run_completed'
  AND timestamp >= now() - INTERVAL 30 DAY

UNION ALL

SELECT
    'Activation rate (%)' AS stage,
    round(
        (SELECT uniqExact(distinct_id) FROM posthog.events
         WHERE event = 'cogni.agent.run_completed'
           AND timestamp >= now() - INTERVAL 30 DAY)
        * 100.0 /
        nullIf((SELECT uniqExact(distinct_id) FROM posthog.events
                WHERE event = 'cogni.auth.signed_in'
                  AND timestamp >= now() - INTERVAL 30 DAY), 0),
        1
    ) AS users

ORDER BY stage;


-- ============================================================================
-- 2. TIME-TO-VALUE: median time from signed_in → first run_completed
-- ============================================================================
-- Measures how quickly new users reach their first successful agent run.

WITH
    first_signin AS (
        SELECT
            distinct_id,
            min(timestamp) AS first_signin_ts
        FROM posthog.events
        WHERE event = 'cogni.auth.signed_in'
          AND timestamp >= now() - INTERVAL 90 DAY
        GROUP BY distinct_id
    ),
    first_run AS (
        SELECT
            distinct_id,
            min(timestamp) AS first_run_ts
        FROM posthog.events
        WHERE event = 'cogni.agent.run_completed'
          AND timestamp >= now() - INTERVAL 90 DAY
        GROUP BY distinct_id
    )
SELECT
    count() AS activated_users,
    round(quantile(0.5)(dateDiff('minute', s.first_signin_ts, r.first_run_ts)), 1) AS median_minutes_to_value,
    round(quantile(0.9)(dateDiff('minute', s.first_signin_ts, r.first_run_ts)), 1) AS p90_minutes_to_value,
    round(avg(dateDiff('minute', s.first_signin_ts, r.first_run_ts)), 1) AS avg_minutes_to_value
FROM first_signin s
INNER JOIN first_run r ON s.distinct_id = r.distinct_id
WHERE r.first_run_ts >= s.first_signin_ts;


-- ============================================================================
-- 3. RETENTION: D1 / D7 cohorts by first run_completed
-- ============================================================================
-- Users who returned and ran an agent 1 day / 7 days after their first run.

WITH
    first_run AS (
        SELECT
            distinct_id,
            toDate(min(timestamp)) AS cohort_date
        FROM posthog.events
        WHERE event = 'cogni.agent.run_completed'
          AND timestamp >= now() - INTERVAL 90 DAY
        GROUP BY distinct_id
    )
SELECT
    fr.cohort_date,
    count() AS cohort_size,
    countIf(d1.distinct_id != '') AS d1_retained,
    round(countIf(d1.distinct_id != '') * 100.0 / count(), 1) AS d1_pct,
    countIf(d7.distinct_id != '') AS d7_retained,
    round(countIf(d7.distinct_id != '') * 100.0 / count(), 1) AS d7_pct
FROM first_run fr
LEFT JOIN (
    SELECT DISTINCT distinct_id, toDate(timestamp) AS activity_date
    FROM posthog.events
    WHERE event = 'cogni.agent.run_completed'
) d1 ON fr.distinct_id = d1.distinct_id
    AND d1.activity_date = fr.cohort_date + 1
LEFT JOIN (
    SELECT DISTINCT distinct_id, toDate(timestamp) AS activity_date
    FROM posthog.events
    WHERE event = 'cogni.agent.run_completed'
) d7 ON fr.distinct_id = d7.distinct_id
    AND d7.activity_date = fr.cohort_date + 7
GROUP BY fr.cohort_date
ORDER BY fr.cohort_date DESC
LIMIT 30;


-- ============================================================================
-- 4. COST PER ACTIVATED USER
-- ============================================================================
-- Total platform cost (sum of cost_usd from completed runs) divided by
-- number of activated users (users with at least one completed run).

SELECT
    round(sum(JSONExtractFloat64(properties, 'cost_usd')), 2) AS total_cost_usd,
    uniqExact(distinct_id) AS activated_users,
    round(
        sum(JSONExtractFloat64(properties, 'cost_usd'))
        / nullIf(uniqExact(distinct_id), 0),
        4
    ) AS cost_per_activated_user_usd
FROM posthog.events
WHERE event = 'cogni.agent.run_completed'
  AND timestamp >= now() - INTERVAL 30 DAY;


-- ============================================================================
-- 5. TOP FAILURES: error_class distribution + failure rate
-- ============================================================================
-- Shows which errors are most common and the overall failure rate.

SELECT
    JSONExtractString(properties, 'error_class') AS error_class,
    JSONExtractString(properties, 'error_code') AS error_code,
    count() AS failure_count,
    round(
        count() * 100.0 / (
            SELECT count() FROM posthog.events
            WHERE event IN ('cogni.agent.run_completed', 'cogni.agent.run_failed')
              AND timestamp >= now() - INTERVAL 30 DAY
        ),
        2
    ) AS failure_rate_pct
FROM posthog.events
WHERE event = 'cogni.agent.run_failed'
  AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY error_class, error_code
ORDER BY failure_count DESC
LIMIT 20;


-- ============================================================================
-- 6. LATENCY BY MODEL: p50 / p95 latency_ms
-- ============================================================================
-- Performance breakdown by LLM model.

SELECT
    JSONExtractString(properties, 'model') AS model,
    count() AS run_count,
    round(quantile(0.5)(JSONExtractFloat64(properties, 'latency_ms')), 0) AS p50_ms,
    round(quantile(0.95)(JSONExtractFloat64(properties, 'latency_ms')), 0) AS p95_ms,
    round(avg(JSONExtractFloat64(properties, 'latency_ms')), 0) AS avg_ms,
    round(sum(JSONExtractFloat64(properties, 'cost_usd')), 4) AS total_cost_usd,
    round(avg(JSONExtractFloat64(properties, 'cost_usd')), 6) AS avg_cost_per_run_usd
FROM posthog.events
WHERE event = 'cogni.agent.run_completed'
  AND timestamp >= now() - INTERVAL 30 DAY
  AND JSONExtractString(properties, 'model') != ''
GROUP BY model
ORDER BY run_count DESC;


-- ============================================================================
-- 7. RUNS PER USER: distribution + heavy users
-- ============================================================================
-- Shows run frequency distribution and identifies power users.

WITH user_runs AS (
    SELECT
        distinct_id,
        count() AS run_count
    FROM posthog.events
    WHERE event IN ('cogni.agent.run_completed', 'cogni.agent.run_failed')
      AND timestamp >= now() - INTERVAL 30 DAY
    GROUP BY distinct_id
)
SELECT
    'Total users with runs' AS metric,
    toString(count()) AS value
FROM user_runs

UNION ALL

SELECT
    'Median runs per user',
    toString(round(quantile(0.5)(run_count), 1))
FROM user_runs

UNION ALL

SELECT
    'p90 runs per user',
    toString(round(quantile(0.9)(run_count), 1))
FROM user_runs

UNION ALL

SELECT
    'Max runs (power user)',
    toString(max(run_count))
FROM user_runs

UNION ALL

SELECT
    'Users with 10+ runs',
    toString(countIf(run_count >= 10))
FROM user_runs

ORDER BY metric;


-- ============================================================================
-- 8. TOOL ADOPTION: % users connecting providers
-- ============================================================================
-- Shows which tool providers are being connected and adoption rates.

WITH
    total_users AS (
        SELECT uniqExact(distinct_id) AS cnt
        FROM posthog.events
        WHERE event = 'cogni.auth.signed_in'
          AND timestamp >= now() - INTERVAL 30 DAY
    )
SELECT
    JSONExtractString(properties, 'provider') AS provider,
    uniqExact(distinct_id) AS users_connected,
    round(
        uniqExact(distinct_id) * 100.0 / nullIf((SELECT cnt FROM total_users), 0),
        1
    ) AS adoption_pct
FROM posthog.events
WHERE event = 'cogni.tool.connection_created'
  AND timestamp >= now() - INTERVAL 30 DAY
GROUP BY provider
ORDER BY users_connected DESC;
