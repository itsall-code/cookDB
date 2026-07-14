use std::collections::HashMap;

use anyhow::{Context, bail};
use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};
use sqlx::{
    Column, Connection, Executor, Row, TypeInfo, ValueRef,
    mysql::{MySqlConnectOptions, MySqlConnection, MySqlPoolOptions, MySqlRow},
    types::{
        BigDecimal,
        chrono::{NaiveDate, NaiveDateTime, NaiveTime},
    },
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
    pub result_sets: Vec<MySqlQueryResultSet>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MySqlQueryResultSet {
    pub statement_index: usize,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct MySqlFlushDbResult {
    pub database: String,
    pub tables_dropped: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MySqlLookupResult {
    pub values: Vec<Value>,
    pub row_count: usize,
    pub limited: bool,
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

pub async fn list_columns(cfg: &MySqlConfig, table: &str) -> anyhow::Result<Vec<String>> {
    validate_mysql_identifier(table)?;
    info!(target = %mysql_target(cfg), table, "mysql list columns");
    let pool = create_pool(cfg, None).await?;
    let columns: Vec<String> = sqlx::query_scalar(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION",
    )
    .bind(table)
    .fetch_all(&pool)
    .await?;
    info!(
        target = %mysql_target(cfg),
        table,
        column_count = columns.len(),
        "mysql list columns ok"
    );
    Ok(columns)
}

const LOOKUP_LIMIT: u32 = 100;

pub async fn lookup_column_value(
    cfg: &MySqlConfig,
    table: &str,
    key_column: &str,
    key_value: &str,
    value_column: &str,
) -> anyhow::Result<MySqlLookupResult> {
    validate_mysql_identifier(table)?;
    validate_mysql_identifier(key_column)?;
    validate_mysql_identifier(value_column)?;

    if key_value.trim().is_empty() {
        bail!("key_value cannot be empty");
    }

    let sql = format!(
        "SELECT `{}` AS lookup_value FROM `{}` WHERE `{}` = ? LIMIT {}",
        escape_mysql_identifier(value_column),
        escape_mysql_identifier(table),
        escape_mysql_identifier(key_column),
        LOOKUP_LIMIT + 1
    );

    info!(
        target = %mysql_target(cfg),
        table,
        key_column,
        value_column,
        "mysql lookup"
    );

    let pool = create_pool(cfg, None).await?;
    let rows = sqlx::query(&sql).bind(key_value).fetch_all(&pool).await?;
    let limited = rows.len() > LOOKUP_LIMIT as usize;
    let rows = rows
        .into_iter()
        .take(LOOKUP_LIMIT as usize)
        .collect::<Vec<_>>();

    let mut values = Vec::with_capacity(rows.len());
    for row in &rows {
        values.push(mysql_value_to_json(row, 0)?);
    }

    info!(
        target = %mysql_target(cfg),
        table,
        row_count = values.len(),
        limited,
        "mysql lookup ok"
    );

    Ok(MySqlLookupResult {
        row_count: values.len(),
        limited,
        values,
    })
}

fn validate_mysql_identifier(name: &str) -> anyhow::Result<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        bail!("identifier cannot be empty");
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        bail!("invalid identifier: {}", trimmed);
    }
    Ok(())
}

fn escape_mysql_identifier(name: &str) -> String {
    name.replace('`', "``")
}

pub async fn query_rows(
    cfg: &MySqlConfig,
    sql: &str,
    limit: Option<u32>,
) -> anyhow::Result<MySqlQueryResult> {
    let statements = validate_query_sql(sql)?;
    let limit = limit.unwrap_or(200).clamp(1, 1000);
    info!(
        target = %mysql_target(cfg),
        limit,
        statement_count = statements.len(),
        sql_preview = %sql_preview(sql, 160),
        "mysql query"
    );

    let mut conn = connect_direct(cfg).await?;
    let mut result_sets = Vec::new();

    for (idx, statement) in statements.iter().enumerate() {
        if is_session_set_statement(statement) {
            conn.execute(statement.as_str()).await?;
            continue;
        }

        let set = fetch_query_result_set(&mut conn, statement, limit, idx + 1).await?;
        result_sets.push(set);
    }

    if result_sets.is_empty() {
        bail!("query must include at least one SELECT statement");
    }

    let first = &result_sets[0];

    info!(
        target = %mysql_target(cfg),
        result_set_count = result_sets.len(),
        row_count = first.row_count,
        column_count = first.columns.len(),
        limited = first.limited,
        "mysql query ok"
    );

    Ok(MySqlQueryResult {
        columns: first.columns.clone(),
        rows: first.rows.clone(),
        row_count: first.row_count,
        limited: first.limited,
        result_sets,
    })
}

async fn fetch_query_result_set(
    conn: &mut MySqlConnection,
    sql: &str,
    limit: u32,
    statement_index: usize,
) -> anyhow::Result<MySqlQueryResultSet> {
    let limited_sql = format!(
        "SELECT * FROM ({}) AS cook_db_query LIMIT {}",
        sql,
        limit + 1
    );
    let rows = sqlx::query(&limited_sql).fetch_all(conn).await?;
    let limited = rows.len() > limit as usize;
    let rows = rows.into_iter().take(limit as usize).collect::<Vec<_>>();

    let columns = rows.first().map(row_columns).unwrap_or_else(Vec::new);
    let row_count = rows.len();
    let rows = rows
        .iter()
        .map(row_to_json)
        .collect::<anyhow::Result<_>>()?;

    Ok(MySqlQueryResultSet {
        statement_index,
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
    let statements = validate_mutation_sql(sql, allow_dangerous)?;

    if statements.iter().any(|sql| is_dangerous_mutation(sql)) {
        warn!(
            target = %mysql_target(cfg),
            allow_dangerous,
            statement_count = statements.len(),
            sql_preview = %sql_preview(sql, 160),
            "mysql dangerous execute"
        );
    } else {
        info!(
            target = %mysql_target(cfg),
            statement_count = statements.len(),
            sql_preview = %sql_preview(sql, 160),
            "mysql execute"
        );
    }

    let pool = create_pool(cfg, None).await?;
    let mut rows_affected = 0u64;
    let mut last_insert_id = 0u64;
    let mut direct_conn: Option<MySqlConnection> = None;

    for statement in &statements {
        let result = if needs_raw_sql(statement) {
            let conn = match direct_conn.as_mut() {
                Some(conn) => conn,
                None => direct_conn.insert(connect_direct(cfg).await?),
            };
            conn.execute(statement.as_str()).await?
        } else {
            sqlx::query(statement.as_str()).execute(&pool).await?
        };
        rows_affected = rows_affected.saturating_add(result.rows_affected());
        if result.last_insert_id() != 0 {
            last_insert_id = result.last_insert_id();
        }
    }

    info!(
        target = %mysql_target(cfg),
        statement_count = statements.len(),
        rows_affected,
        last_insert_id,
        "mysql execute ok"
    );

    Ok(MySqlExecuteResult {
        rows_affected,
        last_insert_id,
    })
}

pub async fn flush_database(cfg: &MySqlConfig) -> anyhow::Result<MySqlFlushDbResult> {
    let database = cfg
        .database
        .as_deref()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| anyhow::anyhow!("mysql database must be specified for flush"))?
        .to_string();

    warn!(
        target = %mysql_target(cfg),
        database = %database,
        "mysql flush database"
    );

    let tables = list_tables(cfg).await?;
    if tables.is_empty() {
        info!(
            target = %mysql_target(cfg),
            database = %database,
            "mysql flush database skipped (no tables)"
        );
        return Ok(MySqlFlushDbResult {
            database,
            tables_dropped: 0,
        });
    }

    let mut conn = connect_direct(cfg).await?;
    conn.execute("SET FOREIGN_KEY_CHECKS = 0")
        .await
        .context("failed to disable foreign key checks")?;

    for chunk in tables.chunks(50) {
        let drop_sql = format!(
            "DROP TABLE IF EXISTS {}",
            chunk
                .iter()
                .map(|table| format!("`{}`", escape_mysql_identifier(table)))
                .collect::<Vec<_>>()
                .join(", ")
        );
        conn.execute(drop_sql.as_str())
            .await
            .with_context(|| format!("failed to drop tables: {}", drop_sql))?;
    }

    conn.execute("SET FOREIGN_KEY_CHECKS = 1")
        .await
        .context("failed to re-enable foreign key checks")?;

    info!(
        target = %mysql_target(cfg),
        database = %database,
        tables_dropped = tables.len(),
        "mysql flush database ok"
    );

    Ok(MySqlFlushDbResult {
        database,
        tables_dropped: tables.len(),
    })
}

fn validate_query_sql(sql: &str) -> anyhow::Result<Vec<String>> {
    let statements = split_sql_statements(sql)?;

    for statement in &statements {
        let lower = statement.trim_start().to_ascii_lowercase();
        if lower.starts_with("select") || is_session_set_statement(statement) {
            continue;
        }
        bail!("only SELECT statements and SET @variable assignments are allowed for query");
    }

    Ok(statements)
}

const BLOCKED_MUTATIONS: &[&str] = &["delete", "truncate", "drop"];

fn needs_raw_sql(sql: &str) -> bool {
    let lower = sql.trim().to_ascii_lowercase();
    ["create", "alter", "drop", "truncate", "rename", "set"]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
}

fn is_session_set_statement(sql: &str) -> bool {
    sql.trim_start().to_ascii_lowercase().starts_with("set @")
}

pub fn is_dangerous_mutation(sql: &str) -> bool {
    let lower = sql.trim().to_ascii_lowercase();
    BLOCKED_MUTATIONS
        .iter()
        .any(|prefix| lower.starts_with(prefix))
}

fn validate_mutation_sql(sql: &str, allow_dangerous: bool) -> anyhow::Result<Vec<String>> {
    let statements = split_sql_statements(sql)?;

    for normalized in &statements {
        let lower = normalized.to_ascii_lowercase();
        let allowed = [
            "insert", "update", "delete", "replace", "create", "alter", "drop", "truncate",
        ];
        if !allowed.iter().any(|prefix| lower.starts_with(prefix)) {
            bail!("only mutation or DDL statements are allowed for execute");
        }

        if is_dangerous_mutation(normalized) && !allow_dangerous {
            bail!(
                "dangerous statement blocked (DELETE/TRUNCATE/DROP). Set allow_dangerous=true and provide confirm_text to proceed"
            );
        }
    }

    Ok(statements)
}

fn split_sql_statements(sql: &str) -> anyhow::Result<Vec<String>> {
    let raw = sql.as_bytes();
    let mut statements = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;

    while i < raw.len() {
        if is_line_comment_start(raw, i) {
            i = skip_line(raw, i);
            continue;
        }

        if raw[i] == b'/' && i + 1 < raw.len() && raw[i + 1] == b'*' {
            i = find_block_comment_end(raw, i + 2)
                .ok_or_else(|| anyhow::anyhow!("unterminated block comment in sql"))?;
            continue;
        }

        let ch = raw[i];
        if ch == b'\'' || ch == b'"' || ch == b'`' {
            i = skip_quoted(raw, i, ch)
                .ok_or_else(|| anyhow::anyhow!("unterminated quoted string in sql"))?;
            continue;
        }

        if ch == b';' {
            push_sql_statement(&mut statements, &sql[start..i])?;
            start = i + 1;
        }
        i += 1;
    }

    push_sql_statement(&mut statements, &sql[start..])?;
    if statements.is_empty() {
        bail!("sql cannot be empty");
    }
    Ok(statements)
}

fn push_sql_statement(statements: &mut Vec<String>, sql: &str) -> anyhow::Result<()> {
    let normalized = strip_sql_comments(sql).trim().to_string();
    if !normalized.is_empty() {
        statements.push(normalized);
    }
    Ok(())
}

fn strip_sql_comments(sql: &str) -> String {
    let raw = sql.as_bytes();
    let mut out = String::with_capacity(sql.len());
    let mut i = 0usize;

    while i < raw.len() {
        if is_line_comment_start(raw, i) {
            i = skip_line(raw, i);
            continue;
        }

        if raw[i] == b'/' && i + 1 < raw.len() && raw[i + 1] == b'*' {
            if let Some(end) = find_block_comment_end(raw, i + 2) {
                i = end;
                continue;
            }
        }

        let ch = raw[i];
        if ch == b'\'' || ch == b'"' || ch == b'`' {
            let start = i;
            i = skip_quoted(raw, i, ch).unwrap_or(raw.len());
            out.push_str(&sql[start..i]);
            continue;
        }

        out.push(ch as char);
        i += 1;
    }

    out
}

fn is_line_comment_start(raw: &[u8], i: usize) -> bool {
    if raw[i] == b'#' {
        return true;
    }
    raw[i] == b'-' && i + 1 < raw.len() && raw[i + 1] == b'-'
}

fn skip_line(raw: &[u8], i: usize) -> usize {
    let mut j = i;
    while j < raw.len() && raw[j] != b'\n' {
        j += 1;
    }
    if j < raw.len() {
        j += 1;
    }
    j
}

fn find_block_comment_end(raw: &[u8], start: usize) -> Option<usize> {
    let mut i = start;
    while i + 1 < raw.len() {
        if raw[i] == b'*' && raw[i + 1] == b'/' {
            return Some(i + 2);
        }
        i += 1;
    }
    None
}

fn skip_quoted(raw: &[u8], start: usize, quote: u8) -> Option<usize> {
    let mut i = start + 1;
    while i < raw.len() {
        if raw[i] == b'\\' {
            i += 2;
            continue;
        }
        if raw[i] == quote {
            return Some(i + 1);
        }
        i += 1;
    }
    None
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

    if type_name.contains("INT") || type_name == "YEAR" {
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

    if matches!(type_name.as_str(), "DECIMAL" | "NEWDECIMAL") {
        if let Ok(value) = row.try_get::<BigDecimal, _>(idx) {
            let text = value.to_string();
            if let Ok(float_value) = text.parse::<f64>() {
                if let Some(number) = Number::from_f64(float_value) {
                    return Ok(Value::Number(number));
                }
            }
            return Ok(Value::String(text));
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

    if matches!(type_name.as_str(), "DATE" | "NEWDATE") {
        if let Ok(value) = row.try_get::<NaiveDate, _>(idx) {
            return Ok(Value::String(value.to_string()));
        }
    }

    if matches!(type_name.as_str(), "DATETIME" | "TIMESTAMP") {
        if let Ok(value) = row.try_get::<NaiveDateTime, _>(idx) {
            return Ok(Value::String(value.to_string()));
        }
    }

    if type_name == "TIME" {
        if let Ok(value) = row.try_get::<NaiveTime, _>(idx) {
            return Ok(Value::String(value.to_string()));
        }
    }

    let value = row
        .try_get::<String, _>(idx)
        .with_context(|| format!("failed to decode mysql column at index {}", idx))?;
    Ok(Value::String(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_mutation_sql_allows_multiple_statements() {
        let statements = validate_mutation_sql(
            "UPDATE users SET name = 'a' WHERE id = 1; INSERT INTO users(name) VALUES ('b');",
            false,
        )
        .expect("valid statements");

        assert_eq!(statements.len(), 2);
        assert_eq!(statements[0], "UPDATE users SET name = 'a' WHERE id = 1");
        assert_eq!(statements[1], "INSERT INTO users(name) VALUES ('b')");
    }

    #[test]
    fn split_mutation_sql_preserves_semicolon_inside_string() {
        let statements = validate_mutation_sql(
            "UPDATE notes SET body = 'hello; world' WHERE id = 1;",
            false,
        )
        .expect("valid statement");

        assert_eq!(
            statements,
            vec!["UPDATE notes SET body = 'hello; world' WHERE id = 1"]
        );
    }

    #[test]
    fn split_mutation_sql_ignores_comments_and_blank_statements() {
        let statements = validate_mutation_sql(
            "-- prepare row\n;\nUPDATE users SET name = 'a' WHERE id = 1; /* done */ ;",
            false,
        )
        .expect("valid statement");

        assert_eq!(statements, vec!["UPDATE users SET name = 'a' WHERE id = 1"]);
    }

    #[test]
    fn split_mutation_sql_blocks_dangerous_later_statement() {
        let err = validate_mutation_sql(
            "UPDATE users SET name = 'a' WHERE id = 1; DROP TABLE users;",
            false,
        )
        .expect_err("dangerous statement should be blocked");

        assert!(
            err.to_string()
                .contains("dangerous statement blocked (DELETE/TRUNCATE/DROP)")
        );
    }

    #[test]
    fn validate_query_sql_allows_multiple_selects() {
        let statements =
            validate_query_sql("SELECT 1 AS a; SELECT 'x;y' AS b;").expect("valid query script");

        assert_eq!(statements, vec!["SELECT 1 AS a", "SELECT 'x;y' AS b"]);
    }

    #[test]
    fn validate_query_sql_allows_user_variable_set_before_select() {
        let statements = validate_query_sql("SET @keyword = 'abc'; SELECT @keyword AS keyword;")
            .expect("valid query script");

        assert_eq!(
            statements,
            vec!["SET @keyword = 'abc'", "SELECT @keyword AS keyword"]
        );
    }

    #[test]
    fn validate_query_sql_blocks_mutation() {
        let err = validate_query_sql("SELECT 1; UPDATE users SET name = 'x';")
            .expect_err("mutation should be blocked");

        assert!(
            err.to_string()
                .contains("only SELECT statements and SET @variable assignments")
        );
    }
}
