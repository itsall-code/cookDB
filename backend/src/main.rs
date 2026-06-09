mod error;
mod models;
mod routes;
mod services;
mod utils;

use axum::Router;
use services::config_service::load_app_config;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::info;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "cook_db=info,tower_http=info,sqlx=warn".into());
    tracing_subscriber::registry()
        .with(filter)
        .with(
            fmt::layer()
                .with_target(true)
                .with_file(true)
                .with_line_number(true)
                .with_thread_ids(false),
        )
        .init();

    let cfg = load_app_config("config/app.json")?;
    let bind_addr = format!("{}:{}", cfg.server.host, cfg.server.port);

    let app = Router::new()
        .merge(routes::health::routes())
        .merge(routes::redis::routes())
        .merge(routes::mysql::routes())
        .merge(routes::process::routes())
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    info!(%bind_addr, "CookDB Rust server listening");

    axum::serve(listener, app).await?;

    Ok(())
}
