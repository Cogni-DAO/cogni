use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub balance_credits: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InsufficientCreditsError {
    pub account_id: String,
    pub required_cost: f64,
    pub available_balance: f64,
}

impl InsufficientCreditsError {
    pub const CODE: &'static str = "INSUFFICIENT_CREDITS";

    #[must_use]
    pub fn shortfall(&self) -> f64 {
        (self.required_cost - self.available_balance).max(0.0)
    }
}

impl fmt::Display for InsufficientCreditsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Account {} has insufficient credits: need {}, have {} (shortfall: {})",
            self.account_id,
            self.required_cost,
            self.available_balance,
            self.shortfall()
        )
    }
}

impl std::error::Error for InsufficientCreditsError {}

#[must_use]
pub fn has_sufficient_credits(account: &Account, cost: f64) -> bool {
    account.balance_credits >= cost
}

pub fn ensure_has_credits(account: &Account, cost: f64) -> Result<(), InsufficientCreditsError> {
    if has_sufficient_credits(account, cost) {
        Ok(())
    } else {
        Err(InsufficientCreditsError {
            account_id: account.id.clone(),
            required_cost: cost,
            available_balance: account.balance_credits,
        })
    }
}
