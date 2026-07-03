use axum::{
    Json, Router,
    routing::{get, post},
};
use tracing::{debug, info, warn};

use crate::{
    error::AppError,
    models::{
        mysql::MySqlConfig,
        request::{
            MySqlColumnsRequest, MySqlExecuteRequest, MySqlFlushDbRequest, MySqlImportFileRequest,
            MySqlImportJobRequest, MySqlLookupRequest, MySqlQueryRequest, MySqlScriptRequest,
            MySqlTableListRequest,
        },
        response::ApiResponse,
    },
    services::{mysql_import, mysql_scripts, mysql_service},
    utils::log_util::mysql_target,
};

pub fn routes() -> Router {
    Router::new()
        .route("/api/mysql/ping", get(ping))
        .route("/api/mysql/test", post(test_connection))
        .route("/api/mysql/tables", post(list_tables))
        .route("/api/mysql/columns", post(list_columns))
        .route("/api/mysql/lookup", post(lookup_column))
        .route("/api/mysql/query", post(query_rows))
        .route("/api/mysql/execute", post(execute_statement))
        .route("/api/mysql/flush-db", post(flush_database))
        .route("/api/mysql/sql-files", get(list_sql_files))
        .route("/api/mysql/scripts", get(list_scripts))
        .route("/api/mysql/script", post(read_script))
        .route("/api/mysql/import-file", post(start_import_file))
        .route("/api/mysql/import-file/status", post(import_file_status))
        .route("/api/mysql/import-file/cancel", post(cancel_import_file))
}

async fn ping() -> Json<ApiResponse<String>> {
    Json(ApiResponse::ok("pong".to_string()))
}

async fn test_connection(
    Json(cfg): Json<MySqlConfig>,
) -> Result<Json<ApiResponse<String>>, AppError> {
    info!(target = %mysql_target(&cfg), "api mysql test");
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
    info!(target = %mysql_target(&req.target), "api mysql tables");
    let tables = mysql_service::list_tables(&req.target).await?;
    Ok(Json(ApiResponse::ok_with_message(
        tables,
        "Loaded mysql tables".to_string(),
    )))
}

async fn list_columns(
    Json(req): Json<MySqlColumnsRequest>,
) -> Result<Json<ApiResponse<Vec<String>>>, AppError> {
    info!(
        target = %mysql_target(&req.target),
        table = %req.table,
        "api mysql columns"
    );
    let columns = mysql_service::list_columns(&req.target, &req.table).await?;
    Ok(Json(ApiResponse::ok_with_message(
        columns,
        "Loaded mysql columns".to_string(),
    )))
}

async fn lookup_column(
    Json(req): Json<MySqlLookupRequest>,
) -> Result<Json<ApiResponse<mysql_service::MySqlLookupResult>>, AppError> {
    info!(
        target = %mysql_target(&req.target),
        table = %req.table,
        key_column = %req.key_column,
        value_column = %req.value_column,
        "api mysql lookup"
    );
    let result = mysql_service::lookup_column_value(
        &req.target,
        &req.table,
        &req.key_column,
        &req.key_value,
        &req.value_column,
    )
    .await?;
    Ok(Json(ApiResponse::ok_with_message(
        result,
        "MySQL lookup complete".to_string(),
    )))
}

async fn query_rows(
    Json(req): Json<MySqlQueryRequest>,
) -> Result<Json<ApiResponse<mysql_service::MySqlQueryResult>>, AppError> {
    info!(
        target = %mysql_target(&req.target),
        limit = ?req.limit,
        "api mysql query"
    );
    let result = mysql_service::query_rows(&req.target, &req.sql, req.limit).await?;
    Ok(Json(ApiResponse::ok_with_message(
        result,
        "MySQL query complete".to_string(),
    )))
}

async fn execute_statement(
    Json(req): Json<MySqlExecuteRequest>,
) -> Result<Json<ApiResponse<mysql_service::MySqlExecuteResult>>, AppError> {
    info!(
        target = %mysql_target(&req.target),
        allow_dangerous = req.allow_dangerous,
        "api mysql execute"
    );
    req.validate_confirm()?;
    let result =
        mysql_service::execute_statement(&req.target, &req.sql, req.allow_dangerous).await?;
    Ok(Json(ApiResponse::ok_with_message(
        result,
        "MySQL statement executed".to_string(),
    )))
}

async fn flush_database(
    Json(req): Json<MySqlFlushDbRequest>,
) -> Result<Json<ApiResponse<mysql_service::MySqlFlushDbResult>>, AppError> {
    warn!(target = %mysql_target(&req.target), "api mysql flush-db");
    req.validate_confirm()?;
    let result = mysql_service::flush_database(&req.target).await?;
    Ok(Json(ApiResponse::ok_with_message(
        result,
        "MySQL database flushed".to_string(),
    )))
}

async fn list_sql_files() -> Result<Json<ApiResponse<Vec<mysql_import::SqlFileEntry>>>, AppError> {
    let files = mysql_import::list_sql_files().await?;
    Ok(Json(ApiResponse::ok_with_message(
        files,
        "Listed SQL files in data directory".to_string(),
    )))
}

async fn list_scripts() -> Result<Json<ApiResponse<Vec<mysql_scripts::SqlScriptEntry>>>, AppError> {
    let files = mysql_scripts::list_scripts().await?;
    Ok(Json(ApiResponse::ok_with_message(
        files,
        "Listed SQL scripts".to_string(),
    )))
}

async fn read_script(
    Json(req): Json<MySqlScriptRequest>,
) -> Result<Json<ApiResponse<mysql_scripts::SqlScriptContent>>, AppError> {
    let script = mysql_scripts::read_script(&req.file_path).await?;
    Ok(Json(ApiResponse::ok_with_message(
        script,
        "Loaded SQL script".to_string(),
    )))
}

async fn start_import_file(
    Json(req): Json<MySqlImportFileRequest>,
) -> Result<Json<ApiResponse<mysql_import::MySqlImportProgress>>, AppError> {
    info!(
        target = %mysql_target(&req.target),
        file_path = %req.file_path,
        "api mysql import-file"
    );
    req.validate_confirm()?;
    let progress = mysql_import::start_import(&req.target, &req.file_path).await?;
    info!(job_id = %progress.job_id, "api mysql import-file started");
    Ok(Json(ApiResponse::ok_with_message(
        progress,
        "SQL import started".to_string(),
    )))
}

async fn import_file_status(
    Json(req): Json<MySqlImportJobRequest>,
) -> Result<Json<ApiResponse<mysql_import::MySqlImportProgress>>, AppError> {
    debug!(job_id = %req.job_id, "api mysql import-file status");
    let progress = mysql_import::get_import_progress(&req.job_id)
        .await
        .ok_or_else(|| AppError::BadRequest("import job not found".to_string()))?;
    Ok(Json(ApiResponse::ok_with_message(
        progress,
        "Import status".to_string(),
    )))
}

async fn cancel_import_file(
    Json(req): Json<MySqlImportJobRequest>,
) -> Result<Json<ApiResponse<mysql_import::MySqlImportProgress>>, AppError> {
    warn!(job_id = %req.job_id, "api mysql import-file cancel");
    let progress = mysql_import::cancel_import(&req.job_id).await?;
    Ok(Json(ApiResponse::ok_with_message(
        progress,
        "Import cancellation requested".to_string(),
    )))
}
