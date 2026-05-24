use std::collections::HashMap;

use anyhow::{Context, bail};
use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};
use sqlx::{
    Column, Row, TypeInfo, ValueRef,
    mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow},
};

use crate::models::mysql::MySqlConfig;

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

pub async fn create_pool(cfg: &MySqlConfig) -> anyhow::Result<sqlx::MySqlPool> {
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

    MySqlPoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .context("failed to connect mysql")
}

pub async fn test_connection(cfg: &MySqlConfig) -> anyhow::Result<()> {
    let pool = create_pool(cfg).await?;
    let _: i32 = sqlx::query_scalar("SELECT 1").fetch_one(&pool).await?;
    Ok(())
}

pub async fn list_tables(cfg: &MySqlConfig) -> anyhow::Result<Vec<String>> {
    let pool = create_pool(cfg).await?;
    let tables: Vec<String> = sqlx::query_scalar("SHOW TABLES").fetch_all(&pool).await?;
    Ok(tables)
}

pub async fn query_rows(
    cfg: &MySqlConfig,
    sql: &str,
    limit: Option<u32>,
) -> anyhow::Result<MySqlQueryResult> {
    validate_select_sql(sql)?;

    let pool = create_pool(cfg).await?;
    let limit = limit.unwrap_or(200).clamp(1, 1000);
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

    Ok(MySqlQueryResult {
        columns,
        rows,
        row_count,
        limited,
    })
}

pub async fn execute_statement(cfg: &MySqlConfig, sql: &str) -> anyhow::Result<MySqlExecuteResult> {
    validate_mutation_sql(sql)?;

    let pool = create_pool(cfg).await?;
    let result = sqlx::query(sql).execute(&pool).await?;

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

fn validate_mutation_sql(sql: &str) -> anyhow::Result<()> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        bail!("sql cannot be empty");
    }
    if trimmed.contains(';') {
        bail!("multiple statements are not allowed");
    }

    let lower = trimmed.to_ascii_lowercase();
    let allowed = [
        "insert", "update", "delete", "replace", "create", "alter", "drop",
    ];
    if !allowed.iter().any(|prefix| lower.starts_with(prefix)) {
        bail!("only mutation or DDL statements are allowed for execute");
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
