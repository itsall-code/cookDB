use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Instant,
};

use anyhow::{Context, bail};
use serde::Serialize;
use sqlx::Executor;
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::Mutex,
    task,
};

use tracing::{debug, error, info, warn};

use crate::{
    models::mysql::MySqlConfig,
    utils::log_util::{format_bytes, mysql_target, sql_preview},
};

use super::mysql_service;

const READ_CHUNK_SIZE: usize = 4 * 1024 * 1024;
const TX_BATCH_STATEMENTS: u64 = 1000;
const LOG_PROGRESS_BYTES: u64 = 100 * 1024 * 1024;
const LOG_PROGRESS_STATEMENTS: u64 = 2000;
const BUFFER_COMPACT_THRESHOLD: usize = 8 * 1024 * 1024;
const CANCEL_CHECK_INTERVAL: u64 = 16;
const PROGRESS_SYNC_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct MySqlImportProgress {
    pub job_id: String,
    pub status: ImportStatus,
    pub file_path: String,
    pub file_size: u64,
    pub bytes_read: u64,
    pub statements_executed: u64,
    pub statements_skipped: u64,
    pub elapsed_ms: u64,
    pub bytes_per_sec: u64,
    pub eta_sec: Option<u64>,
    pub error: Option<String>,
    pub current_preview: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImportStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

struct ImportJobInner {
    progress: Mutex<MySqlImportProgress>,
    cancel: Arc<AtomicBool>,
    bytes_read: AtomicU64,
    statements_executed: AtomicU64,
    statements_skipped: AtomicU64,
    started: StdMutex<Option<Instant>>,
}

static IMPORT_JOBS: std::sync::LazyLock<Mutex<HashMap<String, Arc<ImportJobInner>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

pub async fn start_import(
    cfg: &MySqlConfig,
    file_path: &str,
) -> anyhow::Result<MySqlImportProgress> {
    info!(
        target = %mysql_target(cfg),
        requested_path = %file_path,
        "mysql import requested"
    );

    let resolved = resolve_sql_file_path(file_path)?;
    let metadata = tokio::fs::metadata(&resolved)
        .await
        .with_context(|| format!("cannot read sql file: {}", resolved.display()))?;

    if !metadata.is_file() {
        bail!("path is not a file: {}", resolved.display());
    }

    let job_id = uuid::Uuid::new_v4().to_string();
    info!(
        job_id = %job_id,
        target = %mysql_target(cfg),
        resolved_path = %resolved.display(),
        file_size = metadata.len(),
        file_size_human = %format_bytes(metadata.len()),
        "mysql import job created"
    );
    let cancel = Arc::new(AtomicBool::new(false));
    let progress = MySqlImportProgress {
        job_id: job_id.clone(),
        status: ImportStatus::Pending,
        file_path: resolved.display().to_string(),
        file_size: metadata.len(),
        bytes_read: 0,
        statements_executed: 0,
        statements_skipped: 0,
        elapsed_ms: 0,
        bytes_per_sec: 0,
        eta_sec: None,
        error: None,
        current_preview: None,
    };

    let inner = Arc::new(ImportJobInner {
        progress: Mutex::new(progress.clone()),
        cancel: cancel.clone(),
        bytes_read: AtomicU64::new(0),
        statements_executed: AtomicU64::new(0),
        statements_skipped: AtomicU64::new(0),
        started: StdMutex::new(None),
    });

    IMPORT_JOBS
        .lock()
        .await
        .insert(job_id.clone(), inner.clone());

    let cfg = cfg.clone();
    let path = resolved;
    let log_cfg = cfg.clone();
    let log_path = path.clone();
    task::spawn(async move {
        if let Err(err) = run_import(cfg, path, inner.clone()).await {
            error!(
                job_id = %job_id,
                target = %mysql_target(&log_cfg),
                file = %log_path.display(),
                error = %err,
                "mysql import job failed"
            );
            let mut progress = inner.progress.lock().await;
            progress.status = ImportStatus::Failed;
            progress.error = Some(err.to_string());
        }
    });

    Ok(progress)
}

pub async fn get_import_progress(job_id: &str) -> Option<MySqlImportProgress> {
    let job = {
        let jobs = IMPORT_JOBS.lock().await;
        jobs.get(job_id)?.clone()
    };
    let mut progress = job.progress.lock().await.clone();
    let bytes = job.bytes_read.load(Ordering::Relaxed);
    progress.bytes_read = bytes.min(progress.file_size);
    progress.statements_executed = job.statements_executed.load(Ordering::Relaxed);
    progress.statements_skipped = job.statements_skipped.load(Ordering::Relaxed);
    if let Ok(started) = job.started.lock() {
        if let Some(started) = *started {
            let elapsed_ms = started.elapsed().as_millis() as u64;
            progress.elapsed_ms = elapsed_ms;
            progress.bytes_per_sec = speed(progress.bytes_read, elapsed_ms);
            if progress.bytes_per_sec > 0 && progress.file_size > progress.bytes_read {
                progress.eta_sec =
                    Some((progress.file_size - progress.bytes_read) / progress.bytes_per_sec);
            }
        }
    }
    Some(progress)
}

pub async fn cancel_import(job_id: &str) -> anyhow::Result<MySqlImportProgress> {
    let jobs = IMPORT_JOBS.lock().await;
    let job = jobs
        .get(job_id)
        .ok_or_else(|| anyhow::anyhow!("import job not found"))?;
    job.cancel.store(true, Ordering::SeqCst);
    let progress = job.progress.lock().await.clone();
    warn!(
        job_id = %job_id,
        file = %progress.file_path,
        bytes_read = progress.bytes_read,
        statements_executed = progress.statements_executed,
        "mysql import cancellation requested"
    );
    Ok(progress)
}

pub fn resolve_sql_file_path(file_path: &str) -> anyhow::Result<PathBuf> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        bail!("file_path cannot be empty");
    }

    let path = Path::new(trimmed);
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }

    let cwd = std::env::current_dir().context("failed to resolve current directory")?;
    let candidates = [
        cwd.join(path),
        cwd.join("..").join(path),
        cwd.join("../..").join(path),
    ];

    for candidate in &candidates {
        if candidate.is_file() {
            let resolved = candidate
                .canonicalize()
                .unwrap_or_else(|_| candidate.clone());
            debug!(
                requested = %trimmed,
                resolved = %resolved.display(),
                cwd = %cwd.display(),
                "sql file path resolved"
            );
            return Ok(resolved);
        }
    }

    error!(
        requested = %trimmed,
        cwd = %cwd.display(),
        tried = ?candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>(),
        "sql file not found"
    );

    bail!(
        "sql file not found: {}. cwd={}. tried: {}",
        trimmed,
        cwd.display(),
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );
}

async fn run_import(
    cfg: MySqlConfig,
    path: PathBuf,
    inner: Arc<ImportJobInner>,
) -> anyhow::Result<()> {
    let (job_id, file_size) = {
        let mut progress = inner.progress.lock().await;
        progress.status = ImportStatus::Running;
        (progress.job_id.clone(), progress.file_size)
    };

    info!(
        job_id = %job_id,
        target = %mysql_target(&cfg),
        file = %path.display(),
        file_size_human = %format_bytes(file_size),
        "mysql import started"
    );

    let started = Instant::now();
    *inner.started.lock().expect("import started lock") = Some(started);

    let use_cli = std::env::var("COOK_MYSQL_USE_CLI")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if use_cli && mysql_cli_available().await {
        info!(job_id = %job_id, "mysql import using mysql client (stdin pipe, COOK_MYSQL_USE_CLI=1)");
        match import_via_mysql_cli(&cfg, &path, inner.clone(), &job_id, started).await {
            Ok(()) => return Ok(()),
            Err(err) => {
                error!(
                    job_id = %job_id,
                    error = %err,
                    "mysql client import failed, falling back to built-in importer"
                );
            }
        }
    } else {
        info!(
            job_id = %job_id,
            "mysql import using built-in high-speed importer (set COOK_MYSQL_USE_CLI=1 to force mysql client)"
        );
    }

    import_via_sqlx(&cfg, &path, inner, &job_id, started).await
}

async fn mysql_cli_available() -> bool {
    Command::new("mysql")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

async fn import_via_mysql_cli(
    cfg: &MySqlConfig,
    path: &Path,
    inner: Arc<ImportJobInner>,
    job_id: &str,
    started: Instant,
) -> anyhow::Result<()> {
    let mut cmd = Command::new("mysql");
    cmd.arg(format!("-h{}", cfg.host))
        .arg(format!("-P{}", cfg.port))
        .arg(format!("-u{}", cfg.username))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    if let Some(password) = cfg.password.as_deref() {
        cmd.env("MYSQL_PWD", password);
    }
    if let Some(database) = cfg.database.as_deref().filter(|d| !d.is_empty()) {
        cmd.arg(database);
    }

    let mut child = cmd
        .spawn()
        .context("failed to spawn mysql client; add mysql.exe to PATH")?;
    let mut stdin = child
        .stdin
        .take()
        .context("mysql client stdin unavailable")?;

    let file = File::open(path)
        .await
        .with_context(|| format!("failed to open {}", path.display()))?;
    let mut reader = BufReader::with_capacity(READ_CHUNK_SIZE, file);
    let mut total_bytes = 0u64;
    let mut last_log_bytes = 0u64;

    loop {
        if inner.cancel.load(Ordering::SeqCst) {
            child.kill().await.ok();
            let mut progress = inner.progress.lock().await;
            progress.status = ImportStatus::Cancelled;
            progress.elapsed_ms = started.elapsed().as_millis() as u64;
            warn!(job_id = %job_id, "mysql client import cancelled");
            return Ok(());
        }

        let mut chunk = vec![0u8; READ_CHUNK_SIZE];
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        total_bytes += read as u64;
        stdin.write_all(&chunk[..read]).await?;
        update_bytes_cli(&inner, total_bytes, started).await;

        if total_bytes.saturating_sub(last_log_bytes) >= LOG_PROGRESS_BYTES {
            log_import_progress(inner.clone(), &job_id, "pipe").await;
            last_log_bytes = total_bytes;
        }
    }
    drop(stdin);

    let output = child.wait_with_output().await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "mysql client exited with {}: {}",
            output.status,
            stderr.trim()
        );
    }

    {
        let mut progress = inner.progress.lock().await;
        progress.status = ImportStatus::Completed;
        progress.bytes_read = progress.file_size;
        progress.elapsed_ms = started.elapsed().as_millis() as u64;
        progress.bytes_per_sec = speed(progress.bytes_read, progress.elapsed_ms);
        progress.eta_sec = Some(0);
        progress.current_preview = Some("imported via mysql client".to_string());
        info!(
            job_id = %job_id,
            bytes_read_human = %format_bytes(progress.bytes_read),
            elapsed_ms = progress.elapsed_ms,
            bytes_per_sec_human = %format_bytes(progress.bytes_per_sec),
            "mysql client import completed"
        );
    }
    Ok(())
}

async fn import_via_sqlx(
    cfg: &MySqlConfig,
    path: &Path,
    inner: Arc<ImportJobInner>,
    job_id: &str,
    started: Instant,
) -> anyhow::Result<()> {
    info!(
        job_id = %job_id,
        chunk_size = READ_CHUNK_SIZE,
        tx_batch = TX_BATCH_STATEMENTS,
        "mysql import using built-in text-protocol importer"
    );

    let mut conn = mysql_service::connect_direct(cfg).await?;
    apply_import_session_tuning(&mut conn).await?;
    info!(job_id = %job_id, "mysql import session tuning applied");

    let file = File::open(path)
        .await
        .with_context(|| format!("failed to open {}", path.display()))?;
    let mut reader = BufReader::with_capacity(READ_CHUNK_SIZE, file);
    let mut buffer = Vec::with_capacity(READ_CHUNK_SIZE * 2);
    let mut buf_pos = 0usize;
    let mut tx_count = 0u64;
    let mut total_bytes = 0u64;
    let mut last_log_bytes = 0u64;
    let mut last_log_statements = 0u64;
    let mut batch_no = 0u64;
    let mut in_tx = false;
    let mut chunks_read = 0u64;

    loop {
        if chunks_read % CANCEL_CHECK_INTERVAL == 0 && inner.cancel.load(Ordering::SeqCst) {
            if in_tx {
                exec_sql_text(&mut conn, "ROLLBACK").await.ok();
            }
            sync_progress(&inner, total_bytes, started, None).await;
            let mut progress = inner.progress.lock().await;
            progress.status = ImportStatus::Cancelled;
            warn!(
                job_id = %job_id,
                bytes_read = progress.bytes_read,
                statements_executed = progress.statements_executed,
                "mysql import cancelled"
            );
            return Ok(());
        }

        let mut chunk = vec![0u8; READ_CHUNK_SIZE];
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        chunks_read += 1;
        total_bytes += read as u64;
        inner.bytes_read.store(total_bytes, Ordering::Relaxed);

        let prev_bucket = (total_bytes - read as u64) / PROGRESS_SYNC_BYTES;
        let curr_bucket = total_bytes / PROGRESS_SYNC_BYTES;
        if curr_bucket > prev_bucket {
            sync_progress(&inner, total_bytes, started, None).await;
        }

        if total_bytes.saturating_sub(last_log_bytes) >= LOG_PROGRESS_BYTES {
            sync_progress(&inner, total_bytes, started, None).await;
            log_import_progress(inner.clone(), job_id, "read").await;
            last_log_bytes = total_bytes;
            last_log_statements = inner.statements_executed.load(Ordering::Relaxed);
        }

        buffer.extend_from_slice(&chunk[..read]);

        while let Some((stmt, consumed)) = extract_next_statement(&buffer[buf_pos..]) {
            buf_pos += consumed;
            let committed = execute_import_statement(
                &mut conn,
                &inner,
                job_id,
                stmt,
                &mut in_tx,
                &mut tx_count,
                &mut batch_no,
            )
            .await?;
            if committed {
                last_log_statements = inner.statements_executed.load(Ordering::Relaxed);
            }

            let executed = inner.statements_executed.load(Ordering::Relaxed);
            if executed.saturating_sub(last_log_statements) >= LOG_PROGRESS_STATEMENTS {
                sync_progress(&inner, total_bytes, started, None).await;
                log_import_progress(inner.clone(), job_id, "statements").await;
                last_log_bytes = total_bytes;
                last_log_statements = executed;
            }
        }

        if buf_pos > BUFFER_COMPACT_THRESHOLD {
            buffer.copy_within(buf_pos.., 0);
            buffer.truncate(buffer.len() - buf_pos);
            buf_pos = 0;
        }
    }

    if buf_pos < buffer.len() {
        let tail = std::str::from_utf8(&buffer[buf_pos..])
            .context("sql file contains invalid utf-8 at tail")?
            .trim();
        // Tail may only contain mysqldump session-restore comments (e.g. /*!40103 SET ... */;).
        // Strip a leading conditional comment wrapper before deciding whether it is executable.
        let sql = strip_versioned_comment(tail);
        if !sql.is_empty() && !should_skip_statement(sql) {
            execute_import_statement(
                &mut conn,
                &inner,
                job_id,
                sql.to_string(),
                &mut in_tx,
                &mut tx_count,
                &mut batch_no,
            )
            .await?;
        }
    }

    if in_tx {
        exec_sql_text(&mut conn, "COMMIT").await?;
        info!(
            job_id = %job_id,
            batch_no,
            statements_in_batch = tx_count,
            "mysql import final transaction committed"
        );
    }

    sync_progress(&inner, total_bytes, started, None).await;
    {
        let mut progress = inner.progress.lock().await;
        progress.status = ImportStatus::Completed;
        progress.bytes_read = progress.file_size;
        progress.elapsed_ms = started.elapsed().as_millis() as u64;
        progress.bytes_per_sec = speed(progress.bytes_read, progress.elapsed_ms);
        progress.eta_sec = Some(0);
        progress.current_preview = None;

        info!(
            job_id = %job_id,
            file = %progress.file_path,
            file_size_human = %format_bytes(progress.file_size),
            bytes_read_human = %format_bytes(progress.bytes_read),
            statements_executed = progress.statements_executed,
            statements_skipped = progress.statements_skipped,
            elapsed_ms = progress.elapsed_ms,
            bytes_per_sec_human = %format_bytes(progress.bytes_per_sec),
            batches = batch_no,
            "mysql import completed"
        );
    }
    Ok(())
}

async fn exec_sql_text(conn: &mut sqlx::MySqlConnection, sql: &str) -> anyhow::Result<()> {
    conn.execute(sql).await?;
    Ok(())
}

async fn log_import_progress(inner: Arc<ImportJobInner>, job_id: &str, phase: &str) {
    let progress = inner.progress.lock().await.clone();

    let percent = if progress.file_size > 0 {
        (progress.bytes_read as f64 / progress.file_size as f64) * 100.0
    } else {
        0.0
    };

    info!(
        job_id = %job_id,
        phase,
        percent = format!("{percent:.1}"),
        bytes_read = progress.bytes_read,
        bytes_read_human = %format_bytes(progress.bytes_read),
        file_size_human = %format_bytes(progress.file_size),
        statements_executed = progress.statements_executed,
        statements_skipped = progress.statements_skipped,
        bytes_per_sec_human = %format_bytes(progress.bytes_per_sec),
        eta_sec = ?progress.eta_sec,
        preview = progress.current_preview.as_deref().unwrap_or("-"),
        "mysql import progress"
    );
}

async fn execute_import_statement(
    conn: &mut sqlx::MySqlConnection,
    inner: &Arc<ImportJobInner>,
    job_id: &str,
    sql: String,
    in_tx: &mut bool,
    tx_count: &mut u64,
    batch_no: &mut u64,
) -> anyhow::Result<bool> {
    let sql = sql.trim();
    if sql.is_empty() {
        return Ok(false);
    }

    if should_skip_statement(sql) {
        inner.statements_skipped.fetch_add(1, Ordering::Relaxed);
        return Ok(false);
    }

    // MySQL DDL implicitly commits; flush any open application transaction first.
    if is_ddl_statement(sql) {
        if *in_tx {
            exec_sql_text(conn, "COMMIT").await?;
            *in_tx = false;
            *tx_count = 0;
        }
        let stmt_no = inner.statements_executed.load(Ordering::Relaxed) + 1;
        let preview = sql_preview(sql, 120);
        if stmt_no == 1 {
            info!(
                job_id = %job_id,
                preview = %preview,
                "mysql import first statement"
            );
        }
        exec_sql_text(conn, sql)
            .await
            .with_context(|| format!("failed at DDL statement #{} near: {}", stmt_no, preview))?;
        inner.statements_executed.fetch_add(1, Ordering::Relaxed);
        return Ok(false);
    }

    if *tx_count == 0 {
        exec_sql_text(conn, "START TRANSACTION").await?;
        *in_tx = true;
        *batch_no += 1;
    }

    let stmt_no = inner.statements_executed.load(Ordering::Relaxed) + 1;
    let preview = sql_preview(sql, 120);

    if stmt_no == 1 {
        info!(
            job_id = %job_id,
            preview = %preview,
            "mysql import first statement"
        );
    }

    if let Err(err) = exec_sql_text(conn, sql).await {
        error!(
            job_id = %job_id,
            statement_no = stmt_no,
            batch_no = *batch_no,
            preview = %preview,
            error = %err,
            "mysql import statement failed"
        );
        return Err(err)
            .with_context(|| format!("failed at statement #{} near: {}", stmt_no, preview));
    }

    inner.statements_executed.fetch_add(1, Ordering::Relaxed);
    *tx_count += 1;

    if *tx_count >= TX_BATCH_STATEMENTS {
        exec_sql_text(conn, "COMMIT").await?;
        let total_executed = inner.statements_executed.load(Ordering::Relaxed);
        info!(
            job_id = %job_id,
            batch_no = *batch_no,
            statements_in_batch = *tx_count,
            total_executed,
            "mysql import transaction committed"
        );
        *in_tx = false;
        *tx_count = 0;
        return Ok(true);
    }

    Ok(false)
}

async fn apply_import_session_tuning(conn: &mut sqlx::MySqlConnection) -> anyhow::Result<()> {
    exec_sql_text(conn, "SET SESSION autocommit = 0").await?;
    exec_sql_text(conn, "SET SESSION unique_checks = 0").await?;
    exec_sql_text(conn, "SET SESSION foreign_key_checks = 0").await?;
    exec_sql_text(conn, "SET SESSION sql_notes = 0").await?;
    let _ = exec_sql_text(conn, "SET SESSION sql_log_bin = 0").await;
    Ok(())
}

fn is_ddl_statement(sql: &str) -> bool {
    let upper = sql.trim_start().to_ascii_uppercase();
    upper.starts_with("CREATE")
        || upper.starts_with("DROP")
        || upper.starts_with("ALTER")
        || upper.starts_with("TRUNCATE")
        || upper.starts_with("RENAME")
}

fn should_skip_statement(sql: &str) -> bool {
    let upper = normalize_dump_statement(sql);
    upper.starts_with("SET ") || upper.starts_with("CHANGE MASTER") || upper.starts_with("USE ")
}

/// Strip leading mysqldump version digits accidentally included in conditional comments.
fn normalize_dump_statement(sql: &str) -> String {
    let trimmed = sql.trim_start();
    let digit_len = trimmed
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .count();
    if digit_len > 0 {
        let rest = trimmed[digit_len..].trim_start();
        if rest.len() < trimmed.len() {
            return rest.to_ascii_uppercase();
        }
    }
    trimmed.to_ascii_uppercase()
}

fn skip_mysql_version_digits(raw: &[u8], mut pos: usize) -> usize {
    while pos < raw.len() && raw[pos].is_ascii_digit() {
        pos += 1;
    }
    pos
}

/// Unwrap a leading mysqldump conditional comment `/*!##### ... */` to its inner SQL.
fn strip_versioned_comment(sql: &str) -> &str {
    let trimmed = sql.trim();
    if let Some(rest) = trimmed.strip_prefix("/*!") {
        if let Some(end) = rest.find("*/") {
            let inner = rest[..end].trim_start();
            let inner = inner.trim_start_matches(|c: char| c.is_ascii_digit()).trim();
            return inner.trim_end_matches(';').trim();
        }
    }
    trimmed.trim_end_matches(';').trim()
}

fn extract_next_statement(raw: &[u8]) -> Option<(String, usize)> {
    let mut i = 0usize;
    let len = raw.len();
    let mut stmt_start = 0usize;

    while i < len {
        if is_line_comment_start(raw, i) {
            i = skip_line(raw, i);
            stmt_start = i;
            continue;
        }

        if raw[i] == b'/' && i + 1 < len && raw[i + 1] == b'*' {
            let versioned = i + 2 < len && raw[i + 2] == b'!';
            let end = find_block_comment_end(raw, i + 2)?;
            if versioned {
                let inner_start = skip_mysql_version_digits(raw, i + 3);
                let inner_end = end.saturating_sub(2);
                if inner_end > inner_start {
                    let piece = std::str::from_utf8(&raw[inner_start..inner_end])
                        .ok()?
                        .trim();
                    if !piece.is_empty() {
                        return Some((piece.to_string(), end));
                    }
                }
            }
            i = end;
            stmt_start = i;
            continue;
        }

        let ch = raw[i];
        if ch == b'\'' || ch == b'"' || ch == b'`' {
            i = skip_quoted(raw, i, ch)?;
            continue;
        }

        if ch == b';' {
            let stmt_bytes = &raw[stmt_start..=i];
            let stmt = std::str::from_utf8(stmt_bytes).ok()?.trim();
            if !stmt.is_empty() && stmt != ";" {
                return Some((stmt.trim_end_matches(';').to_string(), i + 1));
            }
            i += 1;
            stmt_start = i;
            continue;
        }

        i += 1;
    }

    None
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

fn truncate_preview(sql: &str, max: usize) -> String {
    let compact: String = sql.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() <= max {
        compact
    } else {
        format!("{}…", &compact[..max])
    }
}

async fn sync_progress(
    inner: &Arc<ImportJobInner>,
    total_bytes: u64,
    started: Instant,
    preview: Option<&str>,
) {
    let mut progress = inner.progress.lock().await;
    progress.bytes_read = total_bytes.min(progress.file_size);
    progress.statements_executed = inner.statements_executed.load(Ordering::Relaxed);
    progress.statements_skipped = inner.statements_skipped.load(Ordering::Relaxed);
    progress.elapsed_ms = started.elapsed().as_millis() as u64;
    progress.bytes_per_sec = speed(progress.bytes_read, progress.elapsed_ms);
    if progress.bytes_per_sec > 0 && progress.file_size > progress.bytes_read {
        let remaining = progress.file_size - progress.bytes_read;
        progress.eta_sec = Some(remaining / progress.bytes_per_sec);
    } else if progress.bytes_read >= progress.file_size {
        progress.eta_sec = Some(0);
    }
    if let Some(text) = preview {
        progress.current_preview = Some(truncate_preview(text, 120));
    }
}

fn speed(bytes: u64, elapsed_ms: u64) -> u64 {
    if elapsed_ms == 0 {
        return 0;
    }
    bytes.saturating_mul(1000) / elapsed_ms
}

async fn update_bytes_cli(inner: &Arc<ImportJobInner>, bytes_read: u64, started: Instant) {
    inner.bytes_read.store(bytes_read, Ordering::Relaxed);
    sync_progress(inner, bytes_read, started, None).await;
}
