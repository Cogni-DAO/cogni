use chrono::{DateTime, Utc};
use cogni_rust_node_core::{
    accounts::{Account, InsufficientCreditsError, ensure_has_credits, has_sufficient_credits},
    ai::{BASELINE_SYSTEM_PROMPT, apply_baseline_system_prompt, estimate_total_tokens},
    billing::{
        calculate_llm_user_charge, calculate_openrouter_top_up, calculate_revenue_share_bonus,
        credits_to_usd, is_margin_preserved, usd_cents_to_credits, usd_to_credits,
    },
    chat::{
        ChatValidationError, DefaultModelInput, Message, assert_message_length,
        filter_system_messages, normalize_message_role, pick_default_model,
        trim_conversation_history,
    },
    payments::{
        PaymentAttempt, PaymentAttemptStatus, is_intent_expired, is_terminal_state,
        is_valid_payment_amount, is_valid_transition, is_verification_timed_out,
        raw_usdc_to_usd_cents, to_client_visible_status, usd_cents_to_raw_usdc,
    },
};
use serde_json::{Number, Value, json};
use std::{fs, path::PathBuf, sync::OnceLock};

fn fixtures() -> &'static Value {
    static FIXTURES: OnceLock<Value> = OnceLock::new();
    FIXTURES.get_or_init(|| {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/generated/node-core.parity.json");
        serde_json::from_str(&fs::read_to_string(path).expect("read node-core parity fixture"))
            .expect("parse node-core parity fixture")
    })
}

fn assert_json_close(actual: &Value, expected: &Value) {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            let af = a.as_f64().expect("actual number as f64");
            let bf = b.as_f64().expect("expected number as f64");
            assert!((af - bf).abs() < 1e-12, "number mismatch: {af} != {bf}");
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "array length mismatch");
            for (a_value, b_value) in a.iter().zip(b.iter()) {
                assert_json_close(a_value, b_value);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "object size mismatch: {a:?} != {b:?}");
            for (key, expected_value) in b {
                let actual_value = a.get(key).unwrap_or_else(|| panic!("missing key: {key}"));
                assert_json_close(actual_value, expected_value);
            }
        }
        _ => assert_eq!(actual, expected),
    }
}

fn u128_from(value: &Value) -> u128 {
    match value {
        Value::String(inner) => inner.parse::<u128>().expect("u128 string"),
        Value::Number(inner) => inner.as_u64().expect("u64 number") as u128,
        _ => panic!("unsupported u128 value: {value:?}"),
    }
}

fn i128_from(value: &Value) -> i128 {
    match value {
        Value::String(inner) => inner.parse::<i128>().expect("i128 string"),
        Value::Number(inner) => inner.as_i64().expect("i64 number") as i128,
        _ => panic!("unsupported i128 value: {value:?}"),
    }
}

fn null_ok() -> Value {
    json!({ "kind": "ok", "value": null })
}

fn insufficient_error(error: InsufficientCreditsError) -> Value {
    json!({
      "name": "InsufficientCreditsError",
      "message": error.to_string(),
      "accountId": error.account_id,
      "requiredCost": error.required_cost,
      "availableBalance": error.available_balance,
      "code": InsufficientCreditsError::CODE,
      "shortfall": error.shortfall(),
    })
}

fn chat_validation_error(error: ChatValidationError) -> Value {
    json!({
      "name": "ChatValidationError",
      "message": error.message,
      "code": error.code.as_str(),
    })
}

#[test]
fn accounts_parity() {
    let section = &fixtures()["accounts"];

    for case in section["hasSufficientCredits"]
        .as_array()
        .expect("accounts has cases")
    {
        let account: Account =
            serde_json::from_value(case["input"]["account"].clone()).expect("account input");
        let actual = Value::Bool(has_sufficient_credits(
            &account,
            case["input"]["cost"].as_f64().unwrap(),
        ));
        assert_json_close(&actual, &case["result"]);
    }

    for case in section["ensureHasCredits"]
        .as_array()
        .expect("ensure cases")
    {
        let account: Account =
            serde_json::from_value(case["input"]["account"].clone()).expect("account input");
        let actual = match ensure_has_credits(&account, case["input"]["cost"].as_f64().unwrap()) {
            Ok(()) => null_ok(),
            Err(error) => json!({ "kind": "error", "value": insufficient_error(error) }),
        };
        assert_json_close(&actual, &case["result"]);
    }
}

#[test]
fn ai_parity() {
    let section = &fixtures()["ai"];

    assert_eq!(
        BASELINE_SYSTEM_PROMPT,
        section["constants"]["baselineSystemPrompt"]
            .as_str()
            .unwrap()
    );

    for case in section["applyBaselineSystemPrompt"]
        .as_array()
        .expect("apply cases")
    {
        let messages: Vec<Message> =
            serde_json::from_value(case["input"]["messages"].clone()).expect("messages");
        let actual = serde_json::to_value(apply_baseline_system_prompt(&messages))
            .expect("serialize messages");
        assert_json_close(&actual, &case["result"]);
    }

    for case in section["estimateTotalTokens"]
        .as_array()
        .expect("estimate cases")
    {
        let messages: Vec<Message> =
            serde_json::from_value(case["input"]["messages"].clone()).expect("messages");
        let actual = Value::Number(Number::from(estimate_total_tokens(&messages)));
        assert_json_close(&actual, &case["result"]);
    }
}

#[test]
fn billing_parity() {
    let section = &fixtures()["billing"];

    for case in section["usdToCredits"].as_array().unwrap() {
        let actual =
            Value::String(usd_to_credits(case["input"]["usd"].as_f64().unwrap()).to_string());
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["creditsToUsd"].as_array().unwrap() {
        let actual = Value::Number(
            Number::from_f64(credits_to_usd(u128_from(&case["input"]["credits"]))).unwrap(),
        );
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["usdCentsToCredits"].as_array().unwrap() {
        let actual = match usd_cents_to_credits(i128_from(&case["input"]["amountUsdCents"])) {
            Ok(value) => json!({ "kind": "ok", "value": value.to_string() }),
            Err(error) => {
                json!({ "kind": "error", "value": { "name": "Error", "message": error } })
            }
        };
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["calculateLlmUserCharge"].as_array().unwrap() {
        let actual = serde_json::to_value(calculate_llm_user_charge(
            case["input"]["providerCostUsd"].as_f64().unwrap(),
            case["input"]["markupFactor"].as_f64().unwrap(),
        ))
        .unwrap();
        let mut actual = actual;
        actual["chargedCredits"] =
            Value::String(actual["chargedCredits"].as_u64().unwrap().to_string());
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["calculateOpenRouterTopUp"].as_array().unwrap() {
        let actual = Value::Number(
            Number::from_f64(calculate_openrouter_top_up(
                case["input"]["amountUsdCents"].as_i64().unwrap(),
                case["input"]["markupFactor"].as_f64().unwrap(),
                case["input"]["revenueShare"].as_f64().unwrap(),
                case["input"]["cryptoFee"].as_f64().unwrap(),
            ))
            .unwrap(),
        );
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["calculateRevenueShareBonus"].as_array().unwrap() {
        let actual = Value::String(
            calculate_revenue_share_bonus(
                u128_from(&case["input"]["purchasedCredits"]),
                case["input"]["revenueShare"].as_f64().unwrap(),
            )
            .to_string(),
        );
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["isMarginPreserved"].as_array().unwrap() {
        let actual = Value::Bool(is_margin_preserved(
            case["input"]["markupFactor"].as_f64().unwrap(),
            case["input"]["revenueShare"].as_f64().unwrap(),
            case["input"]["cryptoFee"].as_f64().unwrap(),
        ));
        assert_json_close(&actual, &case["result"]);
    }
}

#[test]
fn chat_parity() {
    let section = &fixtures()["chat"];

    for case in section["assertMessageLength"].as_array().unwrap() {
        let actual = match assert_message_length(
            case["input"]["content"].as_str().unwrap(),
            case["input"]["maxChars"].as_u64().unwrap() as usize,
        ) {
            Ok(()) => null_ok(),
            Err(error) => json!({ "kind": "error", "value": chat_validation_error(error) }),
        };
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["trimConversationHistory"].as_array().unwrap() {
        let messages: Vec<Message> =
            serde_json::from_value(case["input"]["messages"].clone()).unwrap();
        let actual = serde_json::to_value(trim_conversation_history(
            &messages,
            case["input"]["maxChars"].as_u64().unwrap() as usize,
        ))
        .unwrap();
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["filterSystemMessages"].as_array().unwrap() {
        let messages: Vec<Message> =
            serde_json::from_value(case["input"]["messages"].clone()).unwrap();
        let actual = serde_json::to_value(filter_system_messages(&messages)).unwrap();
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["normalizeMessageRole"].as_array().unwrap() {
        let actual = match normalize_message_role(case["input"]["role"].as_str().unwrap()) {
            Some(value) => Value::String(value),
            None => Value::Null,
        };
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["pickDefaultModel"].as_array().unwrap() {
        let input: DefaultModelInput = serde_json::from_value(case["input"].clone()).unwrap();
        let actual = match pick_default_model(&input) {
            Some(value) => Value::String(value),
            None => Value::Null,
        };
        assert_json_close(&actual, &case["result"]);
    }
}

#[test]
fn payments_parity() {
    let section = &fixtures()["payments"];

    for case in section["isValidTransition"].as_array().unwrap() {
        let from: PaymentAttemptStatus =
            serde_json::from_value(case["input"]["from"].clone()).unwrap();
        let to: PaymentAttemptStatus = serde_json::from_value(case["input"]["to"].clone()).unwrap();
        let actual = Value::Bool(is_valid_transition(from, to));
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["isValidPaymentAmount"].as_array().unwrap() {
        let actual = Value::Bool(is_valid_payment_amount(
            case["input"]["amountUsdCents"].as_i64().unwrap(),
        ));
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["isIntentExpired"].as_array().unwrap() {
        let attempt: PaymentAttempt =
            serde_json::from_value(case["input"]["attempt"].clone()).unwrap();
        let now: DateTime<Utc> = serde_json::from_value(case["input"]["now"].clone()).unwrap();
        let actual = Value::Bool(is_intent_expired(&attempt, now));
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["isVerificationTimedOut"].as_array().unwrap() {
        let attempt: PaymentAttempt =
            serde_json::from_value(case["input"]["attempt"].clone()).unwrap();
        let now: DateTime<Utc> = serde_json::from_value(case["input"]["now"].clone()).unwrap();
        let actual = Value::Bool(is_verification_timed_out(&attempt, now));
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["isTerminalState"].as_array().unwrap() {
        let status: PaymentAttemptStatus =
            serde_json::from_value(case["input"]["status"].clone()).unwrap();
        let actual = Value::Bool(is_terminal_state(status));
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["toClientVisibleStatus"].as_array().unwrap() {
        let status: PaymentAttemptStatus =
            serde_json::from_value(case["input"]["status"].clone()).unwrap();
        let actual = serde_json::to_value(to_client_visible_status(status)).unwrap();
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["usdCentsToRawUsdc"].as_array().unwrap() {
        let actual = Value::String(
            usd_cents_to_raw_usdc(case["input"]["amountUsdCents"].as_i64().unwrap()).to_string(),
        );
        assert_json_close(&actual, &case["result"]);
    }
    for case in section["rawUsdcToUsdCents"].as_array().unwrap() {
        let actual = Value::Number(Number::from(raw_usdc_to_usd_cents(u128_from(
            &case["input"]["amountRaw"],
        )) as u64));
        assert_json_close(&actual, &case["result"]);
    }
}
