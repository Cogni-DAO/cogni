use serde::{Deserialize, Serialize};

pub const CREDITS_PER_USD: u64 = 10_000_000;
const CENTS_PER_USD: u128 = 100;
const REVENUE_SHARE_SCALE: u128 = 10_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmUserCharge {
    pub charged_credits: u128,
    pub user_cost_usd: f64,
}

#[must_use]
pub fn usd_to_credits(usd: f64) -> u128 {
    (usd * CREDITS_PER_USD as f64).ceil() as u128
}

#[must_use]
pub fn credits_to_usd(credits: u128) -> f64 {
    credits as f64 / CREDITS_PER_USD as f64
}

pub fn usd_cents_to_credits(amount_usd_cents: i128) -> Result<u128, String> {
    if amount_usd_cents < 0 {
        return Err("amountUsdCents must be non-negative".to_string());
    }
    let cents = amount_usd_cents as u128;
    Ok((cents * u128::from(CREDITS_PER_USD) + CENTS_PER_USD - 1) / CENTS_PER_USD)
}

#[must_use]
pub fn calculate_revenue_share_bonus(purchased_credits: u128, revenue_share: f64) -> u128 {
    if revenue_share <= 0.0 {
        return 0;
    }
    let share_scaled = (revenue_share * REVENUE_SHARE_SCALE as f64).round() as u128;
    (purchased_credits * share_scaled) / REVENUE_SHARE_SCALE
}

#[must_use]
pub fn calculate_openrouter_top_up(
    amount_usd_cents: i64,
    markup_factor: f64,
    revenue_share: f64,
    crypto_fee: f64,
) -> f64 {
    let payment_usd = amount_usd_cents as f64 / 100.0;
    let denominator = markup_factor * (1.0 - crypto_fee);
    if denominator <= 0.0 {
        0.0
    } else {
        (payment_usd * (1.0 + revenue_share)) / denominator
    }
}

#[must_use]
pub fn is_margin_preserved(markup_factor: f64, revenue_share: f64, crypto_fee: f64) -> bool {
    markup_factor * (1.0 - crypto_fee) > 1.0 + revenue_share
}

#[must_use]
pub fn calculate_llm_user_charge(provider_cost_usd: f64, markup_factor: f64) -> LlmUserCharge {
    let user_cost_usd = provider_cost_usd * markup_factor;
    LlmUserCharge {
        charged_credits: usd_to_credits(user_cost_usd),
        user_cost_usd,
    }
}
