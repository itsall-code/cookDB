use axum::{
    Json, Router,
    routing::{get, post},
};

use crate::{
    error::AppError,
    models::{
        mysql::MySqlConfig,
        request::{MySqlExecuteRequest, MySqlQueryRequest, MySqlTableListRequest},
        response::ApiResponse,
    },
    services::mysql_service,
};

pub fn routes() -> Router {
    Router::new()
        .route("/api/mysql/ping", get(ping))
        .route("/api/mysql/test", post(test_connection))
        .route("/api/mysql/tables", post(list_tables))
        .route("/api/mysql/query", post(query_rows))
        .route("/api/mysql/execute", post(execute_statement))
}

async fn ping() -> Json<ApiResponse<String>> {
    Json(ApiResponse::ok("pong".to_string()))
}

async fn test_connection(
    Json(cfg): Json<MySqlConfig>,
) -> Result<Json<ApiResponse<String>>, AppError> {
    mysql_service::test_connection(&cfg).await?;
    Ok(Json(ApiResponse::ok_with_message(
        "connected".to_string(),
        format!(
            "Connected to mysql {}:{} database {}",
            cfg.host,
            cfg.port,
            cfg.database.as_deref().unwrap_or("")
        ),
    )))
}

async fn list_tables(
    Json(req): Json<MySqlTableListRequest>,
) -> Result<Json<ApiResponse<Vec<String>>>, AppError> {
    let tables = mysql_service::list_tables(&req.target).await?;
    Ok(Json(ApiResponse::ok_with_message(
        tables,
        "Loaded mysql tables".to_string(),
    )))
}

async fn query_rows(
    Json(req): Json<MySqlQueryRequest>,
) -> Result<Json<ApiResponse<mysql_service::MySqlQueryResult>>, AppError> {
    let result = mysql_service::query_rows(&req.target, &req.sql, req.limit).await?;
    Ok(Json(ApiResponse::ok_with_message(
        result,
        "MySQL query complete".to_string(),
    )))
}

async fn execute_statement(
    Json(req): Json<MySqlExecuteRequest>,
) -> Result<Json<ApiResponse<mysql_service::MySqlExecuteResult>>, AppError> {
    req.validate_confirm()?;
    let result = mysql_service::execute_statement(&req.target, &req.sql).await?;
    Ok(Json(ApiResponse::ok_with_message(
        result,
        "MySQL statement executed".to_string(),
    )))
}
