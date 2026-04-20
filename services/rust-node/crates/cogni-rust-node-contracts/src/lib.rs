use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub const AI_EXECUTION_ERROR_CODES: &[&str] = &[
    "invalid_request",
    "not_found",
    "timeout",
    "aborted",
    "rate_limit",
    "internal",
    "insufficient_credits",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LivezStatus {
    #[serde(rename = "alive")]
    Alive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaLivezOutput {
    pub status: LivezStatus,
    pub timestamp: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReadyzStatus {
    #[serde(rename = "healthy")]
    Healthy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaReadyzOutput {
    pub status: ReadyzStatus,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalValidateGrantInput {
    pub graph_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedGrant {
    pub id: String,
    pub user_id: String,
    pub billing_account_id: String,
    pub scopes: Vec<String>,
    pub expires_at: Option<String>,
    pub revoked_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalValidateGrantOutput {
    pub ok: bool,
    pub grant: ValidatedGrant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrantValidationErrorCode {
    GrantNotFound,
    GrantExpired,
    GrantRevoked,
    GrantScopeMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalValidateGrantErrorOutput {
    pub ok: bool,
    pub error: GrantValidationErrorCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GraphRunKind {
    #[serde(rename = "user_immediate")]
    UserImmediate,
    #[serde(rename = "system_scheduled")]
    SystemScheduled,
    #[serde(rename = "system_webhook")]
    SystemWebhook,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalCreateGraphRunInput {
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graph_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_kind: Option<GraphRunKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_for: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalCreateGraphRunOutput {
    pub ok: bool,
    pub run_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GraphRunUpdateStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "success")]
    Success,
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "skipped")]
    Skipped,
    #[serde(rename = "cancelled")]
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalUpdateGraphRunInput {
    pub status: GraphRunUpdateStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalUpdateGraphRunOutput {
    pub ok: bool,
    pub run_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalGraphRunInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_grant_id: Option<String>,
    pub input: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalGraphRunSuccessOutput {
    pub ok: bool,
    pub run_id: String,
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_output: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalGraphRunErrorOutput {
    pub ok: bool,
    pub run_id: String,
    pub trace_id: Option<String>,
    pub error: String,
}

pub fn contract_summary() -> Value {
    json!({
      "meta.livez.read.v1": {
        "input": {"kind": "null"},
        "output": {
          "type": "object",
          "required": ["status", "timestamp"],
          "properties": {
            "status": {"enum": ["alive"]},
            "timestamp": {"type": "string"}
          },
          "additionalProperties": false
        }
      },
      "meta.readyz.read.v1": {
        "input": {"kind": "null"},
        "output": {
          "type": "object",
          "required": ["status", "timestamp"],
          "properties": {
            "status": {"enum": ["healthy"]},
            "timestamp": {"type": "string"},
            "version": {"kind": "optional-string"}
          },
          "additionalProperties": false
        }
      },
      "graph-runs.create.internal.v1": {
        "input": {
          "type": "object",
          "required": ["runId"],
          "properties": {
            "runId": {"type": "string"},
            "graphId": {"kind": "optional-string"},
            "runKind": {"kind": "optional-enum", "enum": ["user_immediate", "system_scheduled", "system_webhook"]},
            "triggerSource": {"kind": "optional-string"},
            "triggerRef": {"kind": "optional-string"},
            "requestedBy": {"kind": "optional-string"},
            "scheduleId": {"kind": "optional-string"},
            "scheduledFor": {"kind": "optional-string"},
            "stateKey": {"kind": "optional-string"}
          },
          "additionalProperties": false
        },
        "output": {
          "type": "object",
          "required": ["ok", "runId"],
          "properties": {
            "ok": {"const": true},
            "runId": {"type": "string"}
          },
          "additionalProperties": false
        }
      },
      "graph-runs.update.internal.v1": {
        "input": {
          "type": "object",
          "required": ["status"],
          "properties": {
            "status": {"enum": ["running", "success", "error", "skipped", "cancelled"]},
            "traceId": {"kind": "optional-nullable-string"},
            "errorMessage": {"kind": "optional-string"},
            "errorCode": {"kind": "optional-string"}
          },
          "additionalProperties": false
        },
        "output": {
          "type": "object",
          "required": ["ok", "runId"],
          "properties": {
            "ok": {"const": true},
            "runId": {"type": "string"}
          },
          "additionalProperties": false
        }
      },
      "grants.validate.internal.v1": {
        "input": {
          "type": "object",
          "required": ["graphId"],
          "properties": {
            "graphId": {"type": "string"}
          },
          "additionalProperties": false
        },
        "output": {
          "type": "object",
          "required": ["ok", "grant"],
          "properties": {
            "ok": {"const": true},
            "grant": {
              "type": "object",
              "required": ["id", "userId", "billingAccountId", "scopes", "expiresAt", "revokedAt", "createdAt"],
              "properties": {
                "id": {"type": "string"},
                "userId": {"type": "string"},
                "billingAccountId": {"type": "string"},
                "scopes": {"kind": "string-array"},
                "expiresAt": {"kind": "nullable-string"},
                "revokedAt": {"kind": "nullable-string"},
                "createdAt": {"type": "string"}
              },
              "additionalProperties": false
            }
          },
          "additionalProperties": false
        },
        "errorOutput": {
          "type": "object",
          "required": ["ok", "error"],
          "properties": {
            "ok": {"const": false},
            "error": {"enum": ["grant_not_found", "grant_expired", "grant_revoked", "grant_scope_mismatch"]}
          },
          "additionalProperties": false
        }
      },
      "graphs.run.internal.v1": {
        "input": {
          "type": "object",
          "required": ["input"],
          "properties": {
            "executionGrantId": {"kind": "optional-nullable-string"},
            "input": {"kind": "record"},
            "runId": {"kind": "optional-string"}
          },
          "additionalProperties": false
        },
        "output": {
          "kind": "discriminated-union",
          "discriminator": "ok",
          "variants": [
            {
              "ok": true,
              "required": ["ok", "runId", "traceId"],
              "properties": {
                "runId": {"type": "string"},
                "traceId": {"kind": "nullable-string"},
                "structuredOutput": {"kind": "optional-unknown"}
              }
            },
            {
              "ok": false,
              "required": ["ok", "runId", "traceId", "error"],
              "properties": {
                "runId": {"type": "string"},
                "traceId": {"kind": "nullable-string"},
                "error": {"enum": AI_EXECUTION_ERROR_CODES}
              }
            }
          ]
        }
      }
    })
}
