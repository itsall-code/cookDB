use crate::models::mysql::MySqlConfig;

pub fn mysql_target(cfg: &MySqlConfig) -> String {
    format!(
        "{}:{}/{}",
        cfg.host,
        cfg.port,
        cfg.database.as_deref().unwrap_or("-")
    )
}

pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}

pub fn sql_preview(sql: &str, max: usize) -> String {
    let compact: String = sql.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() <= max {
        compact
    } else {
        format!("{}…", &compact[..max])
    }
}
