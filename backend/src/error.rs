use axum::{Json, http::StatusCode, response::IntoResponse};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),

    #[error("{0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match self {
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            AppError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
        };

        (
            status,
            Json(ErrorBody {
                success: false,
                message,
            }),
        )
            .into_response()
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        let msg = err.to_string();
        if is_bad_request_message(&msg) {
            AppError::BadRequest(msg)
        } else {
            AppError::Internal(msg)
        }
    }
}

fn is_bad_request_message(msg: &str) -> bool {
    let lower = msg.to_ascii_lowercase();
    [
        "sql cannot be empty",
        "only select statements",
        "only mutation or ddl statements",
        "dangerous statement blocked",
        "query must include",
        "unterminated block comment",
        "unterminated quoted string",
        "mysql host cannot be empty",
        "mysql username cannot be empty",
        "mysql database must be specified",
        "identifier cannot be empty",
        "invalid identifier",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

impl From<redis::RedisError> for AppError {
    fn from(err: redis::RedisError) -> Self {
        AppError::Internal(err.to_string())
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}
