use serde::{Deserialize, Serialize};

use crate::{
    error::AppError,
    models::{
        mysql::MySqlConfig,
        redis::{RedisConfig, ServerConfig},
    },
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupRequest {
    pub source: RedisConfig,
    pub target: RedisConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlushDbRequest {
    pub target: RedisConfig,
    pub confirm_text: String,
}

impl FlushDbRequest {
    pub fn validate_confirm(&self) -> Result<(), AppError> {
        let expected = format!("FLUSHDB db={} host={}", self.target.db, self.target.host);
        if self.confirm_text != expected {
            return Err(AppError::BadRequest(format!(
                "invalid confirm_text, expected: {}",
                expected
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteKeysRequest {
    pub target: RedisConfig,
    pub keys: Vec<String>,
    pub confirm_text: String,
}

impl DeleteKeysRequest {
    pub fn validate_confirm(&self) -> Result<(), AppError> {
        let expected = format!("DELETE {} db={}", self.keys.len(), self.target.db);
        if self.confirm_text != expected {
            return Err(AppError::BadRequest(format!(
                "invalid confirm_text, expected: {}",
                expected
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDeleteRequest {
    pub target: RedisConfig,
    pub tables: Vec<String>,
    pub confirm_text: String,
}

impl TableDeleteRequest {
    pub fn validate_confirm(&self) -> Result<(), AppError> {
        let expected = format!("DELETE_TABLES {} db={}", self.tables.len(), self.target.db);
        if self.confirm_text != expected {
            return Err(AppError::BadRequest(format!(
                "invalid confirm_text, expected: {}",
                expected
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashGetRequest {
    pub target: RedisConfig,
    pub hash_name: String,
    pub field: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashListRequest {
    pub target: RedisConfig,
    pub hash_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashSetRequest {
    pub target: RedisConfig,
    pub hash_name: String,
    pub field: String,
    pub base64_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalizeAccountRequest {
    pub source: RedisConfig,
    pub target: RedisConfig,
    pub hash_name: String,
    pub source_field: String,
    pub target_field: Option<String>,
    pub server: ServerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchLocalizeRequest {
    pub source: RedisConfig,
    pub target: RedisConfig,
    pub hash_name: String,
    pub source_fields: Vec<String>,
    pub server: ServerConfig,
}

fn is_dangerous_mutation(sql: &str) -> bool {
    sql.split(';').any(|statement| {
        let lower = statement.trim().to_ascii_lowercase();
        ["delete", "truncate", "drop"]
            .iter()
            .any(|prefix| lower.starts_with(prefix))
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MySqlQueryRequest {
    pub target: MySqlConfig,
    pub sql: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MySqlExecuteRequest {
    pub target: MySqlConfig,
    pub sql: String,
    pub confirm_text: String,
    #[serde(default)]
    pub allow_dangerous: bool,
}

impl MySqlExecuteRequest {
    pub fn validate_confirm(&self) -> Result<(), AppError> {
        let database = self.target.database.as_deref().unwrap_or("");
        let dangerous = is_dangerous_mutation(&self.sql);
        let expected = if dangerous && self.allow_dangerous {
            format!(
                "DANGEROUS EXECUTE mysql {} db={}",
                self.target.host, database
            )
        } else {
            format!("EXECUTE mysql {} db={}", self.target.host, database)
        };
        if self.confirm_text != expected {
            return Err(AppError::BadRequest(format!(
                "invalid confirm_text, expected: {}",
                expected
            )));
        }
        if dangerous && !self.allow_dangerous {
            return Err(AppError::BadRequest(
                "dangerous statement requires allow_dangerous=true".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MySqlImportFileRequest {
    pub target: MySqlConfig,
    pub file_path: String,
    pub confirm_text: String,
}

impl MySqlImportFileRequest {
    pub fn validate_confirm(&self) -> Result<(), AppError> {
        let database = self.target.database.as_deref().unwrap_or("");
        let file_name = std::path::Path::new(self.file_path.trim())
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(self.file_path.trim());
        let expected = format!(
            "IMPORT mysql {} db={} file={}",
            self.target.host, database, file_name
        );
        if self.confirm_text != expected {
            return Err(AppError::BadRequest(format!(
                "invalid confirm_text, expected: {}",
                expected
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MySqlImportJobRequest {
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MySqlExportRequest {
    pub target: MySqlConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MySqlExportJobRequest {
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MySqlScriptRequest {
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MySqlTableListRequest {
    pub target: MySqlConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MySqlColumnsRequest {
    pub target: MySqlConfig,
    pub table: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MySqlLookupRequest {
    pub target: MySqlConfig,
    pub table: String,
    pub key_column: String,
    pub key_value: String,
    pub value_column: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MySqlFlushDbRequest {
    pub target: MySqlConfig,
    pub confirm_text: String,
}

impl MySqlFlushDbRequest {
    pub fn validate_confirm(&self) -> Result<(), AppError> {
        let database = self.target.database.as_deref().unwrap_or("");
        if database.is_empty() {
            return Err(AppError::BadRequest(
                "mysql database must be specified for flush".to_string(),
            ));
        }
        let expected = format!("FLUSH mysql {} db={}", self.target.host, database);
        if self.confirm_text != expected {
            return Err(AppError::BadRequest(format!(
                "invalid confirm_text, expected: {}",
                expected
            )));
        }
        Ok(())
    }
}
