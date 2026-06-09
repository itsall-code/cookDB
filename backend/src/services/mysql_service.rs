use std::collections::HashMap;

use anyhow::{Context, bail};
use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};
use sqlx::{
    Column, Connection, Executor, Row, TypeInfo, ValueRef,
    mysql::{MySqlConnectOptions, MySqlConnection, MySqlPoolOptions, MySqlRow},
};

use tracing::{debug, info, warn};

use crate::{
    models::mysql::MySqlConfig,
    utils::log_util::{mysql_target, sql_preview},
};

#[derive(Debug, Serialize, Deserialize)]
pub struct MySqlQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, Value>>,
    pub row_count: usize,
    pub limited: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MySqlExecuteResult {
    pub rows_affected: u64,
    pub last_insert_id: u64,
}

pub async fn create_pool(
    cfg: &MySqlConfig,
    max_connections: Option<u32>,
) -> anyhow::Result<sqlx::MySqlPool> {
    let options = mysql_connect_options(cfg)?;

    let max = max_connections.unwrap_or(5);
    debug!(
        target = %mysql_target(cfg),
        max_connections = max,
        "mysql connecting"
    );

    MySqlPoolOptions::new()
        .max_connections(max)
        .connect_with(options)
        .await
        .context("failed to connect mysql")
}

pub fn mysql_connect_options(cfg: &MySqlConfig) -> anyhow::Result<MySqlConnectOptions> {
    if cfg.host.trim().is_empty() {
        bail!("mysql host cannot be empty");
    }
    if cfg.username.trim().is_empty() {
        bail!("mysql username cannot be empty");
    }

    let mut options = MySqlConnectOptions::new()
        .host(&cfg.host)
        .port(cfg.port)
        .username(&cfg.username);

    if let Some(password) = cfg.password.as_deref() {
        options = options.password(password);
    }
    if let Some(database) = cfg
        .database
        .as_deref()
        .filter(|database| !database.is_empty())
    {
        options = options.database(database);
    }

    Ok(options)
}

/// Direct connection for bulk import: disable prepared-statement cache entirely.
pub async fn connect_direct(cfg: &MySqlConfig) -> anyhow::Result<MySqlConnection> {
    let options = mysql_connect_options(cfg)?.statement_cache_capacity(0);
    debug!(target = %mysql_target(cfg), "mysql direct connect for import");
    MySqlConnection::connect_with(&options)
        .await
        .context("failed to connect mysql (direct)")
}

pub async fn test_connection(cfg: &MySqlConfig) -> anyhow::Result<()> {
    info!(target = %mysql_target(cfg), "mysql test connection");
    let pool = create_pool(cfg, None).await?;
    let _: i32 = sqlx::query_scalar("SELECT 1").fetch_one(&pool).await?;
    info!(target = %mysql_target(cfg), "mysql test connection ok");
    Ok(())
}

pub async fn list_tables(cfg: &MySqlConfig) -> anyhow::Result<Vec<String>> {
    info!(target = %mysql_target(cfg), "mysql list tables");
    let pool = create_pool(cfg, None).await?;
    let tables: Vec<String> = sqlx::query_scalar("SHOW TABLES").fetch_all(&pool).await?;
    info!(target = %mysql_target(cfg), table_count = tables.len(), "mysql list tables ok");
    Ok(tables)
}

pub async fn query_rows(
    cfg: &MySqlConfig,
    sql: &str,
    limit: Option<u32>,
) -> anyhow::Result<MySqlQueryResult> {
    validate_select_sql(sql)?;

    let pool = create_pool(cfg, None).await?;
    let limit = limit.unwrap_or(200).clamp(1, 1000);
    info!(
        target = %mysql_target(cfg),
        limit,
        sql_preview = %sql_preview(sql, 160),
        "mysql query"
    );
    let sql = format!(
        "SELECT * FROM ({}) AS cook_db_query LIMIT {}",
        sql,
        limit + 1
    );
    let rows = sqlx::query(&sql).fetch_all(&pool).await?;
    let limited = rows.len() > limit as usize;
    let rows = rows.into_iter().take(limit as usize).collect::<Vec<_>>();

    let columns = rows.first().map(row_columns).unwrap_or_else(Vec::new);
    let row_count = rows.len();
    let rows = rows
        .iter()
        .map(row_to_json)
        .collect::<anyhow::Result<_>>()?;

    info!(
        target = %mysql_target(cfg),
        row_count,
        column_count = columns.len(),
        limited,
        "mysql query ok"
    );

    Ok(MySqlQueryResult {
        columns,
        rows,
        row_count,
        limited,
    })
}

pub async fn execute_statement(
    cfg: &MySqlConfig,
    sql: &str,
    allow_dangerous: bool,
) -> anyhow::Result<MySqlExecuteResult> {
    validate_mutation_sql(sql, allow_dangerous)?;

    if is_dangerous_mutation(sql) {
        warn!(
            target = %mysql_target(cfg),
            allow_dangerous,
            sql_preview = %sql_preview(sql, 160),
            "mysql dangerous execute"
        );
    } else {
        info!(
            target = %mysql_target(cfg),
            sql_preview = %sql_preview(sql, 160),
            "mysql execute"
        );
    }

    let pool = create_pool(cfg, None).await?;
    let result = if needs_raw_sql(sql) {
        let mut conn = connect_direct(cfg).await?;
        conn.execute(sql).await?
    } else {
        sqlx::query(sql).execute(&pool).await?
    };

    info!(
        target = %mysql_target(cfg),
        rows_affected = result.rows_affected(),
        last_insert_id = result.last_insert_id(),
        "mysql execute ok"
    );

    Ok(MySqlExecuteResult {
        rows_affected: result.rows_affected(),
        last_insert_id: result.last_insert_id(),
    })
}

fn validate_select_sql(sql: &str) -> anyhow::Result<()> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        bail!("sql cannot be empty");
    }
    if trimmed.contains(';') {
        bail!("multiple statements are not allowed");
    }
    if !trimmed.to_ascii_lowercase().starts_with("select") {
        bail!("only SELECT statements are allowed for query");
    }
    Ok(())
}

const BLOCKED_MUTATIONS: &[&str] = &["delete", "truncate", "drop"];

fn needs_raw_sql(sql: &str) -> bool {
    let lower = sql.trim().to_ascii_lowercase();
    ["create", "alter", "drop", "truncate", "rename", "set"]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
}

pub fn is_dangerous_mutation(sql: &str) -> bool {
    let lower = sql.trim().to_ascii_lowercase();
    BLOCKED_MUTATIONS
        .iter()
        .any(|prefix| lower.starts_with(prefix))
}

fn validate_mutation_sql(sql: &str, allow_dangerous: bool) -> anyhow::Result<()> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        bail!("sql cannot be empty");
    }
    if trimmed.contains(';') {
        bail!("multiple statements are not allowed");
    }

    let lower = trimmed.to_ascii_lowercase();
    let allowed = [
        "insert", "update", "delete", "replace", "create", "alter", "drop", "truncate",
    ];
    if !allowed.iter().any(|prefix| lower.starts_with(prefix)) {
        bail!("only mutation or DDL statements are allowed for execute");
    }

    if is_dangerous_mutation(trimmed) && !allow_dangerous {
        bail!(
            "dangerous statement blocked (DELETE/TRUNCATE/DROP). Set allow_dangerous=true and provide confirm_text to proceed"
        );
    }

    Ok(())
}

fn row_columns(row: &MySqlRow) -> Vec<String> {
    row.columns()
        .iter()
        .map(|column| column.name().to_string())
        .collect()
}

fn row_to_json(row: &MySqlRow) -> anyhow::Result<HashMap<String, Value>> {
    let mut values = HashMap::new();

    for (idx, column) in row.columns().iter().enumerate() {
        let value = mysql_value_to_json(row, idx)?;
        values.insert(column.name().to_string(), value);
    }

    Ok(values)
}

fn mysql_value_to_json(row: &MySqlRow, idx: usize) -> anyhow::Result<Value> {
    let raw = row.try_get_raw(idx)?;
    if raw.is_null() {
        return Ok(Value::Null);
    }

    let type_name = raw.type_info().name().to_ascii_uppercase();

    if matches!(
        type_name.as_str(),
        "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" | "BIGINT" | "YEAR"
    ) {
        if let Ok(value) = row.try_get::<i64, _>(idx) {
            return Ok(Value::Number(Number::from(value)));
        }
        if let Ok(value) = row.try_get::<u64, _>(idx) {
            return Ok(Value::Number(Number::from(value)));
        }
    }

    if matches!(
        type_name.as_str(),
        "FLOAT" | "DOUBLE" | "DECIMAL" | "NUMERIC" | "REAL"
    ) {
        if let Ok(value) = row.try_get::<f64, _>(idx) {
            if let Some(number) = Number::from_f64(value) {
                return Ok(Value::Number(number));
            }
        }
    }

    if type_name == "BOOLEAN" || type_name == "BOOL" {
        if let Ok(value) = row.try_get::<bool, _>(idx) {
            return Ok(Value::Bool(value));
        }
    }

    if type_name == "JSON" {
        if let Ok(value) = row.try_get::<Value, _>(idx) {
            return Ok(value);
        }
    }

    if type_name.contains("BLOB") || type_name == "BINARY" || type_name == "VARBINARY" {
        let bytes = row.try_get::<Vec<u8>, _>(idx)?;
        return Ok(Value::String(general_purpose::STANDARD.encode(bytes)));
    }

    let value = row
        .try_get::<String, _>(idx)
        .with_context(|| format!("failed to decode mysql column at index {}", idx))?;
    Ok(Value::String(value))
}
