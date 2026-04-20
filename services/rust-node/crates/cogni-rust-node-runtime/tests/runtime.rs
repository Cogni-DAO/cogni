use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use cogni_rust_node_runtime::app::{AppState, RuntimeConfig, router};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

fn test_state() -> AppState {
    AppState::new(RuntimeConfig {
        host: "127.0.0.1".to_string(),
        port: 9101,
        scheduler_api_token: "scheduler-token-for-tests-32chars!!".to_string(),
        default_account_balance_credits: 5_000,
        version: Some("test-sha".to_string()),
    })
}

async fn json_response(response: axum::response::Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn health_endpoints_return_expected_shape() {
    let app = router(test_state());

    let livez = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/livez")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(livez.status(), StatusCode::OK);
    assert_eq!(json_response(livez).await["status"], "alive");

    let readyz = app
        .oneshot(
            Request::builder()
                .uri("/readyz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(readyz.status(), StatusCode::OK);
    let body = json_response(readyz).await;
    assert_eq!(body["status"], "healthy");
    assert_eq!(body["version"], "test-sha");
}

#[tokio::test]
async fn create_graph_run_is_idempotent() {
    let app = router(test_state());
    let payload = json!({ "runId": "3d8d49e6-a2dd-4e94-b781-9bfb9d2bd264" });

    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/internal/graph-runs")
                    .header(
                        "authorization",
                        "Bearer scheduler-token-for-tests-32chars!!",
                    )
                    .header("content-type", "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(json_response(response).await["ok"], true);
    }
}

#[tokio::test]
async fn validate_grant_returns_scheduler_compatible_shape() {
    let app = router(test_state());
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/internal/grants/2513b012-61cc-49e3-88be-124d4661547f/validate")
                .header(
                    "authorization",
                    "Bearer scheduler-token-for-tests-32chars!!",
                )
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "graphId": "rust:terminal" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_response(response).await;
    assert_eq!(body["ok"], true);
    assert_eq!(body["grant"]["id"], "2513b012-61cc-49e3-88be-124d4661547f");
    assert_eq!(body["grant"]["scopes"][0], "graph:execute:rust:terminal");
}

#[tokio::test]
async fn execute_graph_caches_same_idempotency_key_and_payload() {
    let app = router(test_state());
    let payload = json!({
      "runId": "95ed8d11-e985-4d0b-b5d2-fb857df1bb4e",
      "input": {
        "billingAccountId": "billing_alpha",
        "initialBalanceCredits": 10000,
        "providerCostUsd": 0.0005,
        "markupFactor": 2.0
      }
    });

    let request = || {
        Request::builder()
            .method("POST")
            .uri("/api/internal/graphs/langgraph:terminal/runs")
            .header(
                "authorization",
                "Bearer scheduler-token-for-tests-32chars!!",
            )
            .header("idempotency-key", "sched:2026-04-20T12:00:00Z")
            .header("content-type", "application/json")
            .body(Body::from(payload.to_string()))
            .unwrap()
    };

    let first = app.clone().oneshot(request()).await.unwrap();
    let first_body = json_response(first).await;
    assert_eq!(first_body["ok"], true);

    let second = app.clone().oneshot(request()).await.unwrap();
    let second_body = json_response(second).await;
    assert_eq!(first_body, second_body);
}

#[tokio::test]
async fn execute_graph_rejects_idempotency_hash_mismatch() {
    let app = router(test_state());
    let first = json!({
      "input": {
        "billingAccountId": "billing_alpha",
        "initialBalanceCredits": 10000,
        "providerCostUsd": 0.0005
      }
    });
    let second = json!({
      "input": {
        "billingAccountId": "billing_alpha",
        "initialBalanceCredits": 10000,
        "providerCostUsd": 0.0015
      }
    });

    let build_request = |payload: Value| {
        Request::builder()
            .method("POST")
            .uri("/api/internal/graphs/langgraph:terminal/runs")
            .header(
                "authorization",
                "Bearer scheduler-token-for-tests-32chars!!",
            )
            .header("idempotency-key", "duplicate-key")
            .header("content-type", "application/json")
            .body(Body::from(payload.to_string()))
            .unwrap()
    };

    let first_response = app.clone().oneshot(build_request(first)).await.unwrap();
    assert_eq!(first_response.status(), StatusCode::OK);

    let second_response = app.clone().oneshot(build_request(second)).await.unwrap();
    assert_eq!(second_response.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn execute_graph_tracks_account_balance_and_surfaces_insufficient_credits() {
    let state = test_state();
    let app = router(state.clone());
    let first = json!({
      "input": {
        "billingAccountId": "billing_beta",
        "initialBalanceCredits": 6000,
        "providerCostUsd": 0.0002,
        "markupFactor": 2.0
      }
    });
    let second = json!({
      "input": {
        "billingAccountId": "billing_beta",
        "providerCostUsd": 0.001,
        "markupFactor": 4.0
      }
    });

    let build_request = |key: &str, payload: Value| {
        Request::builder()
            .method("POST")
            .uri("/api/internal/graphs/langgraph:terminal/runs")
            .header(
                "authorization",
                "Bearer scheduler-token-for-tests-32chars!!",
            )
            .header("idempotency-key", key)
            .header("content-type", "application/json")
            .body(Body::from(payload.to_string()))
            .unwrap()
    };

    let first_response = app
        .clone()
        .oneshot(build_request("key-1", first))
        .await
        .unwrap();
    let first_body = json_response(first_response).await;
    assert_eq!(first_body["ok"], true);
    assert_eq!(
        first_body["structuredOutput"]["balanceAfterCredits"],
        "2000"
    );

    let second_response = app
        .clone()
        .oneshot(build_request("key-2", second))
        .await
        .unwrap();
    let second_body = json_response(second_response).await;
    assert_eq!(second_body["ok"], false);
    assert_eq!(second_body["error"], "insufficient_credits");

    let accounts = state.accounts.read().await;
    assert_eq!(accounts.get("billing_beta").copied(), Some(2000));
}

#[tokio::test]
async fn temporal_graph_run_flow_tracks_account_balance() {
    let state = test_state();
    let app = router(state.clone());
    let run_id = "6c79f599-fab5-4c07-b4d6-c0d3a567c1e0";
    let grant_id = "2513b012-61cc-49e3-88be-124d4661547f";

    let validate_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/internal/grants/{grant_id}/validate"))
                .header(
                    "authorization",
                    "Bearer scheduler-token-for-tests-32chars!!",
                )
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "graphId": "rust:terminal" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(validate_response.status(), StatusCode::OK);

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/internal/graph-runs")
                .header(
                    "authorization",
                    "Bearer scheduler-token-for-tests-32chars!!",
                )
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                      "runId": run_id,
                      "graphId": "rust:terminal",
                      "runKind": "system_scheduled",
                      "triggerSource": "temporal_schedule",
                      "triggerRef": "rust-node-schedule",
                      "requestedBy": "cogni_system",
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_response.status(), StatusCode::OK);

    let running_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/internal/graph-runs/{run_id}"))
                .header(
                    "authorization",
                    "Bearer scheduler-token-for-tests-32chars!!",
                )
                .header("content-type", "application/json")
                .body(Body::from(json!({ "status": "running" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(running_response.status(), StatusCode::OK);

    let execute_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/internal/graphs/rust:terminal/runs")
                .header(
                    "authorization",
                    "Bearer scheduler-token-for-tests-32chars!!",
                )
                .header("idempotency-key", "rust-node-schedule:2026-04-20T12:00:00Z")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                      "runId": run_id,
                      "executionGrantId": grant_id,
                      "input": {
                        "initialBalanceCredits": 9000,
                        "providerCostUsd": 0.00025,
                        "markupFactor": 2.0
                      }
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(execute_response.status(), StatusCode::OK);
    let execute_body = json_response(execute_response).await;
    assert_eq!(execute_body["ok"], true);
    assert_eq!(execute_body["structuredOutput"]["accountId"], grant_id);
    assert_eq!(
        execute_body["structuredOutput"]["balanceAfterCredits"],
        "4000"
    );

    let trace_id = execute_body["traceId"].as_str().unwrap().to_string();
    let success_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/internal/graph-runs/{run_id}"))
                .header(
                    "authorization",
                    "Bearer scheduler-token-for-tests-32chars!!",
                )
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                      "status": "success",
                      "traceId": trace_id
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(success_response.status(), StatusCode::OK);

    let runs = state.graph_runs.read().await;
    assert_eq!(runs.get(run_id).unwrap().status, "success");
    drop(runs);

    let accounts = state.accounts.read().await;
    assert_eq!(accounts.get(grant_id).copied(), Some(4000));
}
