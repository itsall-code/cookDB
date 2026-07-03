use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use serde::Serialize;
use tracing::{debug, info};

const MAX_SCRIPT_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct SqlScriptEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SqlScriptContent {
    pub path: String,
    pub name: String,
    pub sql: String,
    pub size: u64,
    pub kind: String,
}

pub fn resolve_scripts_dir() -> anyhow::Result<PathBuf> {
    let cwd = std::env::current_dir().context("failed to resolve current directory")?;
    let candidates = [
        cwd.join("scripts"),
        cwd.join("backend").join("scripts"),
        cwd.join("..").join("scripts"),
        cwd.join("../..").join("backend").join("scripts"),
    ];

    for candidate in &candidates {
        if candidate.is_dir() {
            let resolved = candidate
                .canonicalize()
                .unwrap_or_else(|_| candidate.clone());
            debug!(
                resolved = %resolved.display(),
                cwd = %cwd.display(),
                "mysql scripts directory resolved"
            );
            return Ok(resolved);
        }
    }

    bail!(
        "scripts directory not found. cwd={}. tried: {}",
        cwd.display(),
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );
}

pub async fn list_scripts() -> anyhow::Result<Vec<SqlScriptEntry>> {
    let scripts_dir = resolve_scripts_dir()?;
    let root = scripts_dir
        .parent()
        .context("scripts directory has no parent")?
        .canonicalize()
        .unwrap_or_else(|_| scripts_dir.parent().unwrap().to_path_buf());

    let mut entries = Vec::new();
    collect_scripts(&scripts_dir, &root, &mut entries)?;
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    info!(
        scripts_dir = %scripts_dir.display(),
        count = entries.len(),
        "listed mysql script files"
    );
    Ok(entries)
}

pub async fn read_script(file_path: &str) -> anyhow::Result<SqlScriptContent> {
    let resolved = resolve_script_path(file_path)?;
    let metadata = tokio::fs::metadata(&resolved)
        .await
        .with_context(|| format!("cannot read sql script: {}", resolved.display()))?;

    if !metadata.is_file() {
        bail!("path is not a file: {}", resolved.display());
    }
    if metadata.len() > MAX_SCRIPT_BYTES {
        bail!(
            "sql script is too large to load in editor: {} bytes",
            metadata.len()
        );
    }

    let sql = tokio::fs::read_to_string(&resolved)
        .await
        .with_context(|| format!("failed to read sql script: {}", resolved.display()))?;
    let scripts_dir = resolve_scripts_dir()?;
    let root = scripts_dir
        .parent()
        .context("scripts directory has no parent")?
        .canonicalize()
        .unwrap_or_else(|_| scripts_dir.parent().unwrap().to_path_buf());
    let rel = resolved.strip_prefix(&root).unwrap_or(&resolved);
    let path = rel.to_string_lossy().replace('\\', "/");

    Ok(SqlScriptContent {
        path,
        name: resolved
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        sql,
        size: metadata.len(),
        kind: classify_script(&resolved),
    })
}

fn collect_scripts(dir: &Path, root: &Path, out: &mut Vec<SqlScriptEntry>) -> anyhow::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let meta = entry.metadata()?;
        if meta.is_dir() {
            collect_scripts(&path, root, out)?;
            continue;
        }

        if !is_sql_file(&path) {
            continue;
        }

        let rel = path.strip_prefix(root).unwrap_or(&path);
        out.push(SqlScriptEntry {
            path: rel.to_string_lossy().replace('\\', "/"),
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            size: meta.len(),
            kind: classify_script(&path),
        });
    }
    Ok(())
}

fn resolve_script_path(file_path: &str) -> anyhow::Result<PathBuf> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        bail!("file_path cannot be empty");
    }

    let scripts_dir = resolve_scripts_dir()?;
    let root = scripts_dir
        .parent()
        .context("scripts directory has no parent")?
        .canonicalize()
        .unwrap_or_else(|_| scripts_dir.parent().unwrap().to_path_buf());
    let requested = Path::new(trimmed);
    let candidate = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        root.join(requested)
    };
    let resolved = candidate
        .canonicalize()
        .with_context(|| format!("sql script not found: {}", trimmed))?;

    if !resolved.starts_with(&scripts_dir) {
        bail!("sql script path must be under {}", scripts_dir.display());
    }
    if !is_sql_file(&resolved) {
        bail!("sql script must be a .sql file: {}", trimmed);
    }

    Ok(resolved)
}

fn is_sql_file(path: &Path) -> bool {
    path.extension()
        .map(|ext| ext.eq_ignore_ascii_case("sql"))
        .unwrap_or(false)
}

fn classify_script(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if name.contains("template") || name.contains("update") {
        "template".to_string()
    } else if name.contains("audit") || name.contains("health") {
        "audit".to_string()
    } else {
        "tool".to_string()
    }
}
