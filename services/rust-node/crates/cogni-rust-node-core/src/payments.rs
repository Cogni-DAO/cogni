use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const MIN_PAYMENT_CENTS: i64 = 200;
pub const MAX_PAYMENT_CENTS: i64 = 1_000_000;
pub const PAYMENT_INTENT_TTL_MS: i64 = 30 * 60 * 1_000;
pub const PENDING_UNVERIFIED_TTL_MS: i64 = 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PaymentStatus {
    #[serde(rename = "PENDING_VERIFICATION")]
    PendingVerification,
    #[serde(rename = "CONFIRMED")]
    Confirmed,
    #[serde(rename = "FAILED")]
    Failed,
}

impl PaymentStatus {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PendingVerification => "PENDING_VERIFICATION",
            Self::Confirmed => "CONFIRMED",
            Self::Failed => "FAILED",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PaymentAttemptStatus {
    #[serde(rename = "CREATED_INTENT")]
    CreatedIntent,
    #[serde(rename = "PENDING_UNVERIFIED")]
    PendingUnverified,
    #[serde(rename = "CREDITED")]
    Credited,
    #[serde(rename = "REJECTED")]
    Rejected,
    #[serde(rename = "FAILED")]
    Failed,
}

impl PaymentAttemptStatus {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CreatedIntent => "CREATED_INTENT",
            Self::PendingUnverified => "PENDING_UNVERIFIED",
            Self::Credited => "CREDITED",
            Self::Rejected => "REJECTED",
            Self::Failed => "FAILED",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PaymentErrorCode {
    #[serde(rename = "SENDER_MISMATCH")]
    SenderMismatch,
    #[serde(rename = "INVALID_TOKEN")]
    InvalidToken,
    #[serde(rename = "INVALID_RECIPIENT")]
    InvalidRecipient,
    #[serde(rename = "INVALID_CHAIN")]
    InvalidChain,
    #[serde(rename = "INSUFFICIENT_AMOUNT")]
    InsufficientAmount,
    #[serde(rename = "INSUFFICIENT_CONFIRMATIONS")]
    InsufficientConfirmations,
    #[serde(rename = "TX_NOT_FOUND")]
    TxNotFound,
    #[serde(rename = "TX_REVERTED")]
    TxReverted,
    #[serde(rename = "TOKEN_TRANSFER_NOT_FOUND")]
    TokenTransferNotFound,
    #[serde(rename = "RECIPIENT_MISMATCH")]
    RecipientMismatch,
    #[serde(rename = "RECEIPT_NOT_FOUND")]
    ReceiptNotFound,
    #[serde(rename = "INTENT_EXPIRED")]
    IntentExpired,
    #[serde(rename = "RPC_ERROR")]
    RpcError,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentAttempt {
    pub id: String,
    pub billing_account_id: String,
    pub from_address: String,
    pub chain_id: i64,
    pub token: String,
    pub to_address: String,
    #[serde(with = "crate::payments::u128_string")]
    pub amount_raw: u128,
    pub amount_usd_cents: i64,
    pub status: PaymentAttemptStatus,
    pub tx_hash: Option<String>,
    pub error_code: Option<PaymentErrorCode>,
    pub expires_at: Option<DateTime<Utc>>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub last_verify_attempt_at: Option<DateTime<Utc>>,
    pub verify_attempt_count: i64,
    pub created_at: DateTime<Utc>,
}

#[must_use]
pub fn is_valid_transition(from: PaymentAttemptStatus, to: PaymentAttemptStatus) -> bool {
    if from == to {
        return false;
    }
    if matches!(
        from,
        PaymentAttemptStatus::Credited
            | PaymentAttemptStatus::Rejected
            | PaymentAttemptStatus::Failed
    ) {
        return false;
    }
    match from {
        PaymentAttemptStatus::CreatedIntent => {
            matches!(
                to,
                PaymentAttemptStatus::PendingUnverified | PaymentAttemptStatus::Failed
            )
        }
        PaymentAttemptStatus::PendingUnverified => matches!(
            to,
            PaymentAttemptStatus::Credited
                | PaymentAttemptStatus::Rejected
                | PaymentAttemptStatus::Failed
        ),
        PaymentAttemptStatus::Credited
        | PaymentAttemptStatus::Rejected
        | PaymentAttemptStatus::Failed => false,
    }
}

#[must_use]
pub fn is_valid_payment_amount(amount_usd_cents: i64) -> bool {
    amount_usd_cents >= MIN_PAYMENT_CENTS && amount_usd_cents <= MAX_PAYMENT_CENTS
}

#[must_use]
pub fn is_intent_expired(attempt: &PaymentAttempt, now: DateTime<Utc>) -> bool {
    attempt.status == PaymentAttemptStatus::CreatedIntent
        && attempt.expires_at.is_some()
        && now >= attempt.expires_at.expect("checked is_some")
}

#[must_use]
pub fn is_verification_timed_out(attempt: &PaymentAttempt, now: DateTime<Utc>) -> bool {
    if attempt.status != PaymentAttemptStatus::PendingUnverified {
        return false;
    }
    let Some(submitted_at) = attempt.submitted_at else {
        return false;
    };
    now.signed_duration_since(submitted_at).num_milliseconds() > PENDING_UNVERIFIED_TTL_MS
}

#[must_use]
pub fn is_terminal_state(status: PaymentAttemptStatus) -> bool {
    matches!(
        status,
        PaymentAttemptStatus::Credited
            | PaymentAttemptStatus::Rejected
            | PaymentAttemptStatus::Failed
    )
}

#[must_use]
pub fn to_client_visible_status(status: PaymentAttemptStatus) -> PaymentStatus {
    match status {
        PaymentAttemptStatus::CreatedIntent | PaymentAttemptStatus::PendingUnverified => {
            PaymentStatus::PendingVerification
        }
        PaymentAttemptStatus::Credited => PaymentStatus::Confirmed,
        PaymentAttemptStatus::Rejected | PaymentAttemptStatus::Failed => PaymentStatus::Failed,
    }
}

#[must_use]
pub fn usd_cents_to_raw_usdc(amount_usd_cents: i64) -> u128 {
    amount_usd_cents as u128 * 10_000
}

#[must_use]
pub fn raw_usdc_to_usd_cents(amount_raw: u128) -> u128 {
    amount_raw / 10_000
}

pub mod u128_string {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &u128, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<u128, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        value.parse::<u128>().map_err(serde::de::Error::custom)
    }
}
