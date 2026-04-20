use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MAX_MESSAGE_CHARS: usize = 4_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<MessageToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

impl Message {
    #[must_use]
    pub fn system(content: &str) -> Self {
        Self {
            role: "system".to_string(),
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChatErrorCode {
    #[serde(rename = "MESSAGE_TOO_LONG")]
    MessageTooLong,
    #[serde(rename = "INVALID_CONTENT")]
    InvalidContent,
}

impl ChatErrorCode {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MessageTooLong => "MESSAGE_TOO_LONG",
            Self::InvalidContent => "INVALID_CONTENT",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{message}")]
pub struct ChatValidationError {
    pub code: ChatErrorCode,
    pub message: String,
}

pub fn assert_message_length(content: &str, max_chars: usize) -> Result<(), ChatValidationError> {
    let actual_length = content.chars().count();
    if actual_length > max_chars {
        Err(ChatValidationError {
            code: ChatErrorCode::MessageTooLong,
            message: format!(
                "Message length {actual_length} exceeds maximum {max_chars} characters"
            ),
        })
    } else {
        Ok(())
    }
}

#[must_use]
pub fn trim_conversation_history(messages: &[Message], max_chars: usize) -> Vec<Message> {
    if messages.is_empty() {
        return messages.to_vec();
    }

    let total_length = messages
        .iter()
        .map(|message| message.content.chars().count())
        .sum::<usize>();
    if total_length <= max_chars {
        return messages.to_vec();
    }

    let mut result = messages.to_vec();
    let mut current_length = total_length;
    while result.len() > 1 && current_length > max_chars {
        if let Some(removed) = result.first().cloned() {
            result.remove(0);
            current_length -= removed.content.chars().count();
        } else {
            break;
        }
    }
    result
}

#[must_use]
pub fn filter_system_messages(messages: &[Message]) -> Vec<Message> {
    messages
        .iter()
        .filter(|message| message.role != "system")
        .cloned()
        .collect()
}

#[must_use]
pub fn normalize_message_role(role: &str) -> Option<String> {
    match role.to_ascii_lowercase().trim() {
        "user" => Some("user".to_string()),
        "assistant" => Some("assistant".to_string()),
        "system" => Some("system".to_string()),
        "tool" => Some("tool".to_string()),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultModelInput {
    pub balance_credits: f64,
    pub user_choice: Option<String>,
    pub default_free_model_id: Option<String>,
    pub default_paid_model_id: Option<String>,
}

#[must_use]
pub fn pick_default_model(input: &DefaultModelInput) -> Option<String> {
    if input.balance_credits <= 0.0 {
        if let (Some(user_choice), Some(default_free_model_id)) = (
            input.user_choice.as_ref(),
            input.default_free_model_id.as_ref(),
        ) {
            if user_choice == default_free_model_id {
                return Some(user_choice.clone());
            }
        }
        return input.default_free_model_id.clone();
    }

    input
        .user_choice
        .clone()
        .or_else(|| input.default_paid_model_id.clone())
        .or_else(|| input.default_free_model_id.clone())
}
