use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Instant,
};

use anyhow::{Context, bail};
use futures_util::TryStreamExt;
use serde::Serialize;
use sqlx::{Column, Row, TypeInfo, ValueRef, mysql::MySqlRow, types::BigDecimal};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncWriteExt, BufWriter},
    process::Command,
    sync::Mutex,
    task,
};
use tracing::{error, info, warn};

use crate::{
    models::mysql::MySqlConfig,
    utils::log_util::{format_bytes, mysql_target},
};

use super::mysql_service;

const WRITE_BUFFER_SIZE: usize = 4 * 1024 * 1024;
const INSERT_BATCH_ROWS: usize = 500;
const INSERT_BATCH_BYTES: usize = 1024 * 1024;
const LOG_PROGRESS_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct BackupFileEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
pub struct MySqlExportProgress {
    pub job_id: String,
    pub status: ExportStatus,
    pub file_path: String,
    pub file_name: String,
    pub database: String,
    pub bytes_written: u64,
    pub tables_total: u64,
    pub tables_done: u64,
    pub rows_written: u64,
    pub current_table: Option<String>,
    pub elapsed_ms: u64,
    pub error: Option<String>,
}

struct ExportJobInner {
    progress: Mutex<MySqlExportProgress>,
    cancel: Arc<AtomicBool>,
    bytes_written: AtomicU64,
    tables_done: AtomicU64,
    rows_written: AtomicU64,
    current_table: StdMutex<Option<String>>,
    started: StdMutex<Option<Instant>>,
}

static EXPORT_JOBS: std::sync::LazyLock<Mutex<HashMap<String, Arc<ExportJobInner>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn resolve_backup_dir() -> anyhow::Result<PathBuf> {
    let cwd = std::env::current_dir().context("failed to resolve current directory")?;

    // Backups always live in backend/backup regardless of where the server was launched.
    let base = if cwd.file_name().is_some_and(|name| name == "backend") {
        cwd.clone()
    } else if cwd.join("backend").is_dir() {
        cwd.join("backend")
    } else if cwd.join("..").join("backend").is_dir() {
        cwd.join("..").join("backend")
    } else {
        cwd.clone()
    };

    let dir = base.join("backup");
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create backup directory: {}", dir.display()))?;
    Ok(dir.canonicalize().unwrap_or(dir))
}

pub async fn list_backups() -> anyhow::Result<Vec<BackupFileEntry>> {
    let dir = resolve_backup_dir()?;
    let mut entries = Vec::new();

    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        let is_sql = path
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("sql"))
            .unwrap_or(false);
        if !is_sql {
            continue;
        }

        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);

        entries.push(BackupFileEntry {
            path: path.display().to_string(),
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            size: meta.len(),
            modified_ms,
        });
    }

    entries.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    info!(
        backup_dir = %dir.display(),
        count = entries.len(),
        "listed backup files"
    );
    Ok(entries)
}

pub async fn start_export(cfg: &MySqlConfig) -> anyhow::Result<MySqlExportProgress> {
    let database = cfg
        .database
        .as_deref()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| anyhow::anyhow!("mysql database must be specified for export"))?
        .to_string();

    let backup_dir = resolve_backup_dir()?;
    let timestamp = sqlx::types::chrono::Local::now().format("%Y%m%d_%H%M%S_%3f");
    let file_name = format!("{database}_{timestamp}.sql");
    let file_path = backup_dir.join(&file_name);

    let job_id = uuid::Uuid::new_v4().to_string();
    info!(
        job_id = %job_id,
        target = %mysql_target(cfg),
        file = %file_path.display(),
        "mysql export job created"
    );

    let progress = MySqlExportProgress {
        job_id: job_id.clone(),
        status: ExportStatus::Pending,
        file_path: file_path.display().to_string(),
        file_name,
        database,
        bytes_written: 0,
        tables_total: 0,
        tables_done: 0,
        rows_written: 0,
        current_table: None,
        elapsed_ms: 0,
        error: None,
    };

    let inner = Arc::new(ExportJobInner {
        progress: Mutex::new(progress.clone()),
        cancel: Arc::new(AtomicBool::new(false)),
        bytes_written: AtomicU64::new(0),
        tables_done: AtomicU64::new(0),
        rows_written: AtomicU64::new(0),
        current_table: StdMutex::new(None),
        started: StdMutex::new(None),
    });

    EXPORT_JOBS
        .lock()
        .await
        .insert(job_id.clone(), inner.clone());

    let cfg = cfg.clone();
    let log_cfg = cfg.clone();
    task::spawn(async move {
        if let Err(err) = run_export(cfg, file_path.clone(), inner.clone()).await {
            error!(
                job_id = %job_id,
                target = %mysql_target(&log_cfg),
                file = %file_path.display(),
                error = %err,
                "mysql export job failed"
            );
            tokio::fs::remove_file(&file_path).await.ok();
            let mut progress = inner.progress.lock().await;
            if progress.status != ExportStatus::Completed {
                progress.status = ExportStatus::Failed;
                progress.error = Some(err.to_string());
            }
        }
    });

    Ok(progress)
}

pub async fn get_export_progress(job_id: &str) -> Option<MySqlExportProgress> {
    let job = {
        let jobs = EXPORT_JOBS.lock().await;
        jobs.get(job_id)?.clone()
    };
    let mut progress = job.progress.lock().await.clone();
    progress.bytes_written = job.bytes_written.load(Ordering::Relaxed);
    progress.tables_done = job.tables_done.load(Ordering::Relaxed);
    progress.rows_written = job.rows_written.load(Ordering::Relaxed);
    if let Ok(current) = job.current_table.lock() {
        progress.current_table = current.clone();
    }
    if let Ok(started) = job.started.lock() {
        if let Some(started) = *started {
            progress.elapsed_ms = started.elapsed().as_millis() as u64;
        }
    }
    Some(progress)
}

pub async fn cancel_export(job_id: &str) -> anyhow::Result<MySqlExportProgress> {
    let jobs = EXPORT_JOBS.lock().await;
    let job = jobs
        .get(job_id)
        .ok_or_else(|| anyhow::anyhow!("export job not found"))?;
    job.cancel.store(true, Ordering::SeqCst);
    let progress = job.progress.lock().await.clone();
    warn!(
        job_id = %job_id,
        file = %progress.file_path,
        "mysql export cancellation requested"
    );
    Ok(progress)
}

async fn run_export(
    cfg: MySqlConfig,
    path: PathBuf,
    inner: Arc<ExportJobInner>,
) -> anyhow::Result<()> {
    let job_id = {
        let mut progress = inner.progress.lock().await;
        progress.status = ExportStatus::Running;
        progress.job_id.clone()
    };

    let started = Instant::now();
    *inner.started.lock().expect("export started lock") = Some(started);

    info!(
        job_id = %job_id,
        target = %mysql_target(&cfg),
        file = %path.display(),
        "mysql export started"
    );

    if mysqldump_available().await {
        info!(job_id = %job_id, "mysql export using mysqldump");
        match export_via_mysqldump(&cfg, &path, &inner, &job_id).await {
            Ok(true) => {
                finish_export(&inner, &job_id, started).await;
                return Ok(());
            }
            Ok(false) => {
                // Cancelled: partial file already removed.
                return Ok(());
            }
            Err(err) => {
                error!(
                    job_id = %job_id,
                    error = %err,
                    "mysqldump export failed, falling back to built-in exporter"
                );
                tokio::fs::remove_file(&path).await.ok();
                inner.bytes_written.store(0, Ordering::Relaxed);
                inner.tables_done.store(0, Ordering::Relaxed);
                inner.rows_written.store(0, Ordering::Relaxed);
            }
        }
    } else {
        info!(job_id = %job_id, "mysqldump not found, using built-in exporter");
    }

    if export_via_sqlx(&cfg, &path, &inner, &job_id).await? {
        finish_export(&inner, &job_id, started).await;
    }
    Ok(())
}

async fn finish_export(inner: &Arc<ExportJobInner>, job_id: &str, started: Instant) {
    let mut progress = inner.progress.lock().await;
    progress.status = ExportStatus::Completed;
    progress.bytes_written = inner.bytes_written.load(Ordering::Relaxed);
    progress.tables_done = inner.tables_done.load(Ordering::Relaxed);
    progress.rows_written = inner.rows_written.load(Ordering::Relaxed);
    progress.current_table = None;
    progress.elapsed_ms = started.elapsed().as_millis() as u64;
    progress.error = None;
    info!(
        job_id = %job_id,
        file = %progress.file_path,
        bytes_written_human = %format_bytes(progress.bytes_written),
        tables_done = progress.tables_done,
        rows_written = progress.rows_written,
        elapsed_ms = progress.elapsed_ms,
        "mysql export completed"
    );
}

async fn mark_cancelled(inner: &Arc<ExportJobInner>, job_id: &str, path: &PathBuf) {
    tokio::fs::remove_file(path).await.ok();
    let mut progress = inner.progress.lock().await;
    progress.status = ExportStatus::Cancelled;
    warn!(job_id = %job_id, "mysql export cancelled, partial file removed");
}

async fn mysqldump_available() -> bool {
    Command::new("mysqldump")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Returns Ok(true) on success, Ok(false) when cancelled.
async fn export_via_mysqldump(
    cfg: &MySqlConfig,
    path: &PathBuf,
    inner: &Arc<ExportJobInner>,
    job_id: &str,
) -> anyhow::Result<bool> {
    let database = cfg.database.as_deref().unwrap_or_default();

    let mut cmd = Command::new("mysqldump");
    cmd.arg(format!("-h{}", cfg.host))
        .arg(format!("-P{}", cfg.port))
        .arg(format!("-u{}", cfg.username))
        .arg("--single-transaction")
        .arg("--quick")
        .arg("--no-tablespaces")
        .arg(database)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    if let Some(password) = cfg.password.as_deref() {
        cmd.env("MYSQL_PWD", password);
    }

    let mut child = cmd.spawn().context("failed to spawn mysqldump")?;
    let mut stdout = child
        .stdout
        .take()
        .context("mysqldump stdout unavailable")?;
    let mut stderr = child
        .stderr
        .take()
        .context("mysqldump stderr unavailable")?;

    let stderr_task = task::spawn(async move {
        let mut buf = String::new();
        stderr.read_to_string(&mut buf).await.ok();
        buf
    });

    let file = File::create(path)
        .await
        .with_context(|| format!("failed to create {}", path.display()))?;
    let mut writer = BufWriter::with_capacity(WRITE_BUFFER_SIZE, file);
    let mut chunk = vec![0u8; WRITE_BUFFER_SIZE];
    let mut total = 0u64;
    let mut last_log = 0u64;

    loop {
        if inner.cancel.load(Ordering::SeqCst) {
            child.kill().await.ok();
            drop(writer);
            mark_cancelled(inner, job_id, path).await;
            return Ok(false);
        }

        let read = stdout.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        writer.write_all(&chunk[..read]).await?;
        total += read as u64;
        inner.bytes_written.store(total, Ordering::Relaxed);

        if total.saturating_sub(last_log) >= LOG_PROGRESS_BYTES {
            info!(
                job_id = %job_id,
                bytes_written_human = %format_bytes(total),
                "mysql export progress (mysqldump)"
            );
            last_log = total;
        }
    }

    writer.flush().await?;
    let status = child.wait().await?;
    let stderr_text = stderr_task.await.unwrap_or_default();
    if !status.success() {
        bail!("mysqldump exited with {}: {}", status, stderr_text.trim());
    }

    Ok(true)
}

/// Returns Ok(true) on success, Ok(false) when cancelled.
async fn export_via_sqlx(
    cfg: &MySqlConfig,
    path: &PathBuf,
    inner: &Arc<ExportJobInner>,
    job_id: &str,
) -> anyhow::Result<bool> {
    let database = cfg.database.as_deref().unwrap_or_default().to_string();
    let tables = mysql_service::list_tables(cfg).await?;

    {
        let mut progress = inner.progress.lock().await;
        progress.tables_total = tables.len() as u64;
    }

    let mut conn = mysql_service::connect_direct(cfg).await?;

    let file = File::create(path)
        .await
        .with_context(|| format!("failed to create {}", path.display()))?;
    let mut writer = CountingWriter {
        writer: BufWriter::with_capacity(WRITE_BUFFER_SIZE, file),
        inner: inner.clone(),
    };

    writer
        .write_str(&format!(
            "-- Cook-DB MySQL dump\n-- Database: {}\n-- Exported at: {}\n\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n",
            database,
            sqlx::types::chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        ))
        .await?;

    for table in &tables {
        if inner.cancel.load(Ordering::SeqCst) {
            mark_cancelled(inner, job_id, path).await;
            return Ok(false);
        }

        if let Ok(mut current) = inner.current_table.lock() {
            *current = Some(table.clone());
        }

        let escaped = table.replace('`', "``");
        let create_sql: String = {
            let row = sqlx::query(&format!("SHOW CREATE TABLE `{escaped}`"))
                .fetch_one(&mut conn)
                .await
                .with_context(|| format!("SHOW CREATE TABLE failed for {table}"))?;
            row.try_get::<String, _>(1)?
        };

        writer
            .write_str(&format!(
                "--\n-- Table structure for `{table}`\n--\n\nDROP TABLE IF EXISTS `{escaped}`;\n{create_sql};\n\n"
            ))
            .await?;

        let finished =
            export_table_rows(&mut conn, &mut writer, inner, job_id, table, &escaped).await?;
        if !finished {
            mark_cancelled(inner, job_id, path).await;
            return Ok(false);
        }

        inner.tables_done.fetch_add(1, Ordering::Relaxed);
        info!(
            job_id = %job_id,
            table = %table,
            tables_done = inner.tables_done.load(Ordering::Relaxed),
            tables_total = tables.len(),
            bytes_written_human = %format_bytes(inner.bytes_written.load(Ordering::Relaxed)),
            "mysql export table done"
        );
    }

    writer
        .write_str("SET FOREIGN_KEY_CHECKS = 1;\n\n-- Dump completed\n")
        .await?;
    writer.writer.flush().await?;
    Ok(true)
}

/// Returns Ok(true) when the table was fully written, Ok(false) when cancelled mid-table.
async fn export_table_rows(
    conn: &mut sqlx::MySqlConnection,
    writer: &mut CountingWriter,
    inner: &Arc<ExportJobInner>,
    job_id: &str,
    table: &str,
    escaped: &str,
) -> anyhow::Result<bool> {
    let select_sql = format!("SELECT * FROM `{escaped}`");
    let mut stream = sqlx::query(&select_sql).fetch(conn);

    let mut batch = String::new();
    let mut batch_rows = 0usize;
    let mut columns_header: Option<String> = None;
    let mut row_no = 0u64;

    while let Some(row) = stream
        .try_next()
        .await
        .with_context(|| format!("failed to read rows from {table}"))?
    {
        row_no += 1;
        if row_no % 1024 == 0 && inner.cancel.load(Ordering::SeqCst) {
            return Ok(false);
        }

        let header = match &columns_header {
            Some(header) => header.clone(),
            None => {
                let cols = row
                    .columns()
                    .iter()
                    .map(|col| format!("`{}`", col.name().replace('`', "``")))
                    .collect::<Vec<_>>()
                    .join(", ");
                let header = format!("INSERT INTO `{escaped}` ({cols}) VALUES\n");
                columns_header = Some(header.clone());
                header
            }
        };

        let mut literal = String::with_capacity(64);
        literal.push('(');
        for idx in 0..row.columns().len() {
            if idx > 0 {
                literal.push_str(", ");
            }
            literal.push_str(&mysql_value_to_literal(&row, idx)?);
        }
        literal.push(')');

        if batch_rows == 0 {
            batch.push_str(&header);
        } else {
            batch.push_str(",\n");
        }
        batch.push_str(&literal);
        batch_rows += 1;
        inner.rows_written.fetch_add(1, Ordering::Relaxed);

        if batch_rows >= INSERT_BATCH_ROWS || batch.len() >= INSERT_BATCH_BYTES {
            batch.push_str(";\n");
            writer.write_str(&batch).await?;
            batch.clear();
            batch_rows = 0;
        }
    }

    if batch_rows > 0 {
        batch.push_str(";\n");
        writer.write_str(&batch).await?;
    }
    if row_no > 0 {
        writer.write_str("\n").await?;
    }

    if row_no > 0 {
        info!(
            job_id = %job_id,
            table = %table,
            rows = row_no,
            "mysql export table rows written"
        );
    }
    Ok(true)
}

struct CountingWriter {
    writer: BufWriter<File>,
    inner: Arc<ExportJobInner>,
}

impl CountingWriter {
    async fn write_str(&mut self, text: &str) -> anyhow::Result<()> {
        self.writer.write_all(text.as_bytes()).await?;
        self.inner
            .bytes_written
            .fetch_add(text.len() as u64, Ordering::Relaxed);
        Ok(())
    }
}

fn escape_sql_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    for ch in value.chars() {
        match ch {
            '\'' => out.push_str("\\'"),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\0' => out.push_str("\\0"),
            '\u{1a}' => out.push_str("\\Z"),
            _ => out.push(ch),
        }
    }
    out
}

fn bytes_to_hex_literal(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return "''".to_string();
    }
    let mut out = String::with_capacity(2 + bytes.len() * 2);
    out.push_str("0x");
    for byte in bytes {
        out.push_str(&format!("{byte:02X}"));
    }
    out
}

fn mysql_value_to_literal(row: &MySqlRow, idx: usize) -> anyhow::Result<String> {
    let raw = row.try_get_raw(idx)?;
    if raw.is_null() {
        return Ok("NULL".to_string());
    }

    let type_name = raw.type_info().name().to_ascii_uppercase();

    if type_name.contains("INT") || type_name == "YEAR" {
        if let Ok(value) = row.try_get::<i64, _>(idx) {
            return Ok(value.to_string());
        }
        if let Ok(value) = row.try_get::<u64, _>(idx) {
            return Ok(value.to_string());
        }
    }

    if matches!(type_name.as_str(), "FLOAT" | "DOUBLE" | "REAL") {
        if let Ok(value) = row.try_get::<f64, _>(idx) {
            return Ok(value.to_string());
        }
    }

    if matches!(type_name.as_str(), "DECIMAL" | "NEWDECIMAL" | "NUMERIC") {
        if let Ok(value) = row.try_get::<BigDecimal, _>(idx) {
            return Ok(value.to_string());
        }
    }

    if type_name == "BIT" {
        if let Ok(value) = row.try_get::<u64, _>(idx) {
            return Ok(value.to_string());
        }
    }

    if type_name == "BOOLEAN" || type_name == "BOOL" {
        if let Ok(value) = row.try_get::<bool, _>(idx) {
            return Ok(if value { "1" } else { "0" }.to_string());
        }
    }

    if type_name == "JSON" {
        if let Ok(value) = row.try_get::<serde_json::Value, _>(idx) {
            return Ok(format!("'{}'", escape_sql_string(&value.to_string())));
        }
    }

    if type_name.contains("BLOB") || type_name == "BINARY" || type_name == "VARBINARY" {
        let bytes = row.try_get::<Vec<u8>, _>(idx)?;
        return Ok(bytes_to_hex_literal(&bytes));
    }

    if let Ok(value) = row.try_get::<String, _>(idx) {
        return Ok(format!("'{}'", escape_sql_string(&value)));
    }

    // Fallback for any type that fails text decoding (e.g. unexpected binary payloads).
    let bytes = row
        .try_get::<Vec<u8>, _>(idx)
        .with_context(|| format!("failed to decode mysql column at index {idx} for export"))?;
    Ok(bytes_to_hex_literal(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_quotes_and_control_chars() {
        assert_eq!(
            escape_sql_string("a'b\\c\nd\re\0f"),
            "a\\'b\\\\c\\nd\\re\\0f"
        );
    }

    #[test]
    fn hex_literal_for_binary() {
        assert_eq!(bytes_to_hex_literal(&[0xde, 0xad, 0x01]), "0xDEAD01");
        assert_eq!(bytes_to_hex_literal(&[]), "''");
    }
}
