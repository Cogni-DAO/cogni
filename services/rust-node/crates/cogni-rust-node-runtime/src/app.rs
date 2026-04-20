use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, Request, StatusCode, header::AUTHORIZATION},
    middleware::{self, Next},
    response::Response,
    routing::{get, patch, post},
};
use chrono::Utc;
use cogni_rust_node_contracts::{
    GrantValidationErrorCode, InternalCreateGraphRunInput, InternalCreateGraphRunOutput,
    InternalGraphRunErrorOutput, InternalGraphRunInput, InternalGraphRunSuccessOutput,
    InternalUpdateGraphRunInput, InternalUpdateGraphRunOutput, InternalValidateGrantErrorOutput,
    InternalValidateGrantInput, InternalValidateGrantOutput, MetaLivezOutput, MetaReadyzOutput,
    ReadyzStatus, ValidatedGrant,
};
use cogni_rust_node_core::{
    accounts::{Account, ensure_has_credits},
    ai::{ESTIMATED_USD_PER_1K_TOKENS, estimate_total_tokens},
    billing::calculate_llm_user_charge,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub host: String,
    pub port: u16,
    pub scheduler_api_token: String,
    pub default_account_balance_credits: u128,
    pub version: Option<String>,
}

impl RuntimeConfig {
    #[must_use]
    pub fn from_env() -> Self {
        Self {
            host: std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: std::env::var("PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(9101),
            scheduler_api_token: std::env::var("SCHEDULER_API_TOKEN")
                .unwrap_or_else(|_| "test-scheduler-api-token-for-rust-node".to_string()),
            default_account_balance_credits: std::env::var("DEFAULT_ACCOUNT_BALANCE_CREDITS")
                .ok()
                .and_then(|value| value.parse::<u128>().ok())
                .unwrap_or(50_000),
            version: std::env::var("GIT_SHA").ok(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub config: RuntimeConfig,
    pub accounts: Arc<RwLock<HashMap<String, u128>>>,
    pub graph_runs: Arc<RwLock<HashMap<String, GraphRunRecord>>>,
    pub idempotency: Arc<RwLock<HashMap<String, IdempotencyEntry>>>,
}

impl AppState {
    #[must_use]
    pub fn new(config: RuntimeConfig) -> Self {
        Self {
            config,
            accounts: Arc::new(RwLock::new(HashMap::new())),
            graph_runs: Arc::new(RwLock::new(HashMap::new())),
            idempotency: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRunRecord {
    pub run_id: String,
    pub graph_id: Option<String>,
    pub status: String,
    pub trace_id: Option<String>,
    pub state_key: Option<String>,
    pub error_message: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone)]
pub enum IdempotencyEntry {
    Pending {
        request_hash: String,
        run_id: String,
    },
    Completed {
        request_hash: String,
        response: Value,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionInput {
    billing_account_id: Option<String>,
    provider_cost_usd: Option<f64>,
    markup_factor: Option<f64>,
    initial_balance_credits: Option<u128>,
    messages: Option<Vec<cogni_rust_node_core::chat::Message>>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/livez", get(livez))
        .route("/readyz", get(readyz))
        .route(
            "/api/internal/grants/{grant_id}/validate",
            post(validate_grant),
        )
        .route("/api/internal/graph-runs", post(create_graph_run))
        .route("/api/internal/graph-runs/{run_id}", patch(update_graph_run))
        .route("/api/internal/graphs/{graph_id}/runs", post(execute_graph))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state)
}

async fn auth_middleware(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let path = request.uri().path();
    if path == "/livez" || path == "/readyz" {
        return Ok(next.run(request).await);
    }

    let Some(header_value) = request.headers().get(AUTHORIZATION) else {
        return Err(StatusCode::UNAUTHORIZED);
    };
    let Ok(header_value) = header_value.to_str() else {
        return Err(StatusCode::UNAUTHORIZED);
    };
    let Some(token) = header_value.strip_prefix("Bearer ") else {
        return Err(StatusCode::UNAUTHORIZED);
    };
    if token.trim() != state.config.scheduler_api_token {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(next.run(request).await)
}

async fn livez() -> Json<MetaLivezOutput> {
    Json(MetaLivezOutput {
        status: cogni_rust_node_contracts::LivezStatus::Alive,
        timestamp: Utc::now().to_rfc3339(),
    })
}

async fn readyz(State(state): State<AppState>) -> Json<MetaReadyzOutput> {
    Json(MetaReadyzOutput {
        status: ReadyzStatus::Healthy,
        timestamp: Utc::now().to_rfc3339(),
        version: state.config.version.clone(),
    })
}

async fn create_graph_run(
    State(state): State<AppState>,
    Json(input): Json<InternalCreateGraphRunInput>,
) -> Result<Json<InternalCreateGraphRunOutput>, (StatusCode, Json<Value>)> {
    let mut runs = state.graph_runs.write().await;
    runs.entry(input.run_id.clone())
        .or_insert_with(|| GraphRunRecord {
            run_id: input.run_id.clone(),
            graph_id: input.graph_id.clone(),
            status: "pending".to_string(),
            trace_id: None,
            state_key: input.state_key.clone(),
            error_message: None,
            error_code: None,
        });
    Ok(Json(InternalCreateGraphRunOutput {
        ok: true,
        run_id: input.run_id,
    }))
}

async fn update_graph_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    Json(input): Json<InternalUpdateGraphRunInput>,
) -> Result<Json<InternalUpdateGraphRunOutput>, (StatusCode, Json<Value>)> {
    let mut runs = state.graph_runs.write().await;
    let Some(record) = runs.get_mut(&run_id) else {
        return Err((StatusCode::NOT_FOUND, Json(json!({ "error": "Not found" }))));
    };

    record.status = match input.status {
        cogni_rust_node_contracts::GraphRunUpdateStatus::Running => "running",
        cogni_rust_node_contracts::GraphRunUpdateStatus::Success => "success",
        cogni_rust_node_contracts::GraphRunUpdateStatus::Error => "error",
        cogni_rust_node_contracts::GraphRunUpdateStatus::Skipped => "skipped",
        cogni_rust_node_contracts::GraphRunUpdateStatus::Cancelled => "cancelled",
    }
    .to_string();
    record.trace_id = input.trace_id.clone();
    record.error_message = input.error_message.clone();
    record.error_code = input.error_code.clone();

    Ok(Json(InternalUpdateGraphRunOutput { ok: true, run_id }))
}

async fn validate_grant(
    Path(grant_id): Path<String>,
    Json(input): Json<InternalValidateGrantInput>,
) -> Result<Json<InternalValidateGrantOutput>, (StatusCode, Json<Value>)> {
    let graph_id = input.graph_id;

    if !graph_id.contains(':') {
        warn!(
            event = "rust_node.grant_rejected",
            grant_id,
            graph_id = graph_id.as_str(),
            error = "grant_scope_mismatch",
            "grant validation rejected"
        );
        return Err(grant_validation_error(
            GrantValidationErrorCode::GrantScopeMismatch,
        ));
    }

    let error = if grant_id.starts_with("missing-") {
        Some(GrantValidationErrorCode::GrantNotFound)
    } else if grant_id.starts_with("expired-") {
        Some(GrantValidationErrorCode::GrantExpired)
    } else if grant_id.starts_with("revoked-") {
        Some(GrantValidationErrorCode::GrantRevoked)
    } else if grant_id.starts_with("scope-mismatch-") {
        Some(GrantValidationErrorCode::GrantScopeMismatch)
    } else {
        None
    };

    if let Some(error) = error {
        warn!(
            event = "rust_node.grant_rejected",
            grant_id,
            graph_id = graph_id.as_str(),
            error = ?error,
            "grant validation rejected"
        );
        return Err(grant_validation_error(error));
    }

    let suffix = grant_id[..grant_id.len().min(8)].to_string();
    info!(
        event = "rust_node.grant_validated",
        grant_id,
        graph_id = graph_id.as_str(),
        "grant validated"
    );
    Ok(Json(InternalValidateGrantOutput {
        ok: true,
        grant: ValidatedGrant {
            id: grant_id,
            user_id: format!("rust-user-{suffix}"),
            billing_account_id: format!("rust-billing-{suffix}"),
            scopes: vec![format!("graph:execute:{graph_id}")],
            expires_at: None,
            revoked_at: None,
            created_at: Utc::now().to_rfc3339(),
        },
    }))
}

async fn execute_graph(
    State(state): State<AppState>,
    Path(graph_id): Path<String>,
    headers: HeaderMap,
    Json(input): Json<InternalGraphRunInput>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !graph_id.contains(':') {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Graph not found" })),
        ));
    }

    let Some(idempotency_key) = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
    else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Idempotency-Key header required" })),
        ));
    };

    let request_hash = compute_request_hash(&graph_id, &input.input);

    {
        let idempotency = state.idempotency.read().await;
        if let Some(existing) = idempotency.get(&idempotency_key) {
            match existing {
                IdempotencyEntry::Pending {
                    request_hash: existing_hash,
                    run_id,
                } => {
                    if *existing_hash == request_hash {
                        return Err((
                            StatusCode::CONFLICT,
                            Json(json!({
                              "error": "Execution in progress",
                              "message": "Request with this Idempotency-Key is currently being processed",
                              "runId": run_id,
                            })),
                        ));
                    }
                    return Err((
                        StatusCode::UNPROCESSABLE_ENTITY,
                        Json(json!({
                          "error": "Idempotency conflict",
                          "message": "Request with same Idempotency-Key but different payload already processed",
                        })),
                    ));
                }
                IdempotencyEntry::Completed {
                    request_hash: existing_hash,
                    response,
                } => {
                    if *existing_hash == request_hash {
                        return Ok(Json(response.clone()));
                    }
                    return Err((
                        StatusCode::UNPROCESSABLE_ENTITY,
                        Json(json!({
                          "error": "Idempotency conflict",
                          "message": "Request with same Idempotency-Key but different payload already processed",
                        })),
                    ));
                }
            }
        }
    }

    let run_id = input
        .run_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let trace_id = Some(Uuid::new_v4().to_string());

    {
        let mut idempotency = state.idempotency.write().await;
        idempotency.insert(
            idempotency_key.clone(),
            IdempotencyEntry::Pending {
                request_hash: request_hash.clone(),
                run_id: run_id.clone(),
            },
        );
    }

    let response =
        match perform_graph_execution(&state, &graph_id, &run_id, trace_id.clone(), &input).await {
            Ok(response) => response,
            Err((status, payload)) => {
                let mut idempotency = state.idempotency.write().await;
                idempotency.remove(&idempotency_key);
                return Err((status, payload));
            }
        };

    let mut idempotency = state.idempotency.write().await;
    idempotency.insert(
        idempotency_key,
        IdempotencyEntry::Completed {
            request_hash,
            response: response.clone(),
        },
    );

    Ok(Json(response))
}

async fn perform_graph_execution(
    state: &AppState,
    graph_id: &str,
    run_id: &str,
    trace_id: Option<String>,
    request: &InternalGraphRunInput,
) -> Result<Value, (StatusCode, Json<Value>)> {
    let execution_input = serde_json::from_value::<ExecutionInput>(Value::Object(
        request
            .input
            .clone()
            .into_iter()
            .collect::<Map<String, Value>>(),
    ))
    .unwrap_or(ExecutionInput {
        billing_account_id: None,
        provider_cost_usd: None,
        markup_factor: None,
        initial_balance_credits: None,
        messages: None,
    });

    let account_id = execution_input
        .billing_account_id
        .clone()
        .or_else(|| request.execution_grant_id.clone())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({
                  "error": "billingAccountId or executionGrantId is required in payload"
                })),
            )
        })?;

    let provider_cost_usd = execution_input.provider_cost_usd.unwrap_or_else(|| {
        execution_input
            .messages
            .as_ref()
            .map(|messages| {
                estimate_total_tokens(messages) as f64 / 1_000.0 * ESTIMATED_USD_PER_1K_TOKENS
            })
            .unwrap_or(0.0001)
    });
    let markup_factor = execution_input.markup_factor.unwrap_or(1.0);
    let charge = calculate_llm_user_charge(provider_cost_usd, markup_factor);

    let balance_before = {
        let mut accounts = state.accounts.write().await;
        let entry = accounts.entry(account_id.clone()).or_insert(
            execution_input
                .initial_balance_credits
                .unwrap_or(state.config.default_account_balance_credits),
        );
        *entry
    };

    let account = Account {
        id: account_id.clone(),
        balance_credits: balance_before as f64,
        display_name: None,
    };

    let result = ensure_has_credits(&account, charge.charged_credits as f64);
    if let Err(err) = result {
        let mut runs = state.graph_runs.write().await;
        runs.insert(
            run_id.to_string(),
            GraphRunRecord {
                run_id: run_id.to_string(),
                graph_id: Some(graph_id.to_string()),
                status: "error".to_string(),
                trace_id: trace_id.clone(),
                state_key: None,
                error_message: Some(err.to_string()),
                error_code: Some("insufficient_credits".to_string()),
            },
        );
        warn!(
            event = "rust_node.graph_run_rejected",
            run_id,
            graph_id,
            account_id,
            charged_credits = charge.charged_credits.to_string(),
            balance_before_credits = balance_before.to_string(),
            "graph execution rejected"
        );
        return Ok(serde_json::to_value(InternalGraphRunErrorOutput {
            ok: false,
            run_id: run_id.to_string(),
            trace_id,
            error: "insufficient_credits".to_string(),
        })
        .expect("serializable error response"));
    }

    let balance_after = {
        let mut accounts = state.accounts.write().await;
        let entry = accounts.entry(account_id.clone()).or_insert(balance_before);
        *entry = entry.saturating_sub(charge.charged_credits);
        *entry
    };

    let structured_output = json!({
        "terminal": "graph-executor-compatible",
        "graphId": graph_id,
        "runId": run_id,
        "accountId": account_id,
        "chargedCredits": charge.charged_credits.to_string(),
        "balanceBeforeCredits": balance_before.to_string(),
        "balanceAfterCredits": balance_after.to_string(),
        "providerCostUsd": provider_cost_usd,
        "markupFactor": markup_factor,
    });

    {
        let mut runs = state.graph_runs.write().await;
        runs.insert(
            run_id.to_string(),
            GraphRunRecord {
                run_id: run_id.to_string(),
                graph_id: Some(graph_id.to_string()),
                status: "success".to_string(),
                trace_id: trace_id.clone(),
                state_key: None,
                error_message: None,
                error_code: None,
            },
        );
    }

    info!(
        event = "rust_node.graph_run_completed",
        run_id,
        graph_id,
        account_id = structured_output["accountId"].as_str().unwrap_or_default(),
        charged_credits = structured_output["chargedCredits"]
            .as_str()
            .unwrap_or_default(),
        balance_before_credits = structured_output["balanceBeforeCredits"]
            .as_str()
            .unwrap_or_default(),
        balance_after_credits = structured_output["balanceAfterCredits"]
            .as_str()
            .unwrap_or_default(),
        "graph execution completed"
    );

    Ok(serde_json::to_value(InternalGraphRunSuccessOutput {
        ok: true,
        run_id: run_id.to_string(),
        trace_id,
        structured_output: Some(structured_output),
    })
    .expect("serializable success response"))
}

fn compute_request_hash(graph_id: &str, input: &BTreeMap<String, Value>) -> String {
    let normalized = canonicalize_value(&json!({
        "graphId": graph_id,
        "input": Value::Object(input.clone().into_iter().collect()),
    }));
    normalized.to_string()
}

fn canonicalize_value(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut normalized = Map::new();
            let mut keys = map.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                if let Some(inner) = map.get(&key) {
                    normalized.insert(key, canonicalize_value(inner));
                }
            }
            Value::Object(normalized)
        }
        Value::Array(values) => Value::Array(values.iter().map(canonicalize_value).collect()),
        _ => value.clone(),
    }
}

fn grant_validation_error(error: GrantValidationErrorCode) -> (StatusCode, Json<Value>) {
    (
        StatusCode::FORBIDDEN,
        Json(
            serde_json::to_value(InternalValidateGrantErrorOutput { ok: false, error })
                .expect("serializable grant validation error"),
        ),
    )
}
