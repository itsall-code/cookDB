mod error;
mod models;
mod routes;
mod services;
mod utils;

use axum::Router;
use services::config_service::load_app_config;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().init();

    let cfg = load_app_config("config/app.json")?;
    let bind_addr = format!("{}:{}", cfg.server.host, cfg.server.port);

    let app = Router::new()
        .merge(routes::health::routes())
        .merge(routes::redis::routes())
        .merge(routes::mysql::routes())
        .merge(routes::process::routes())
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    println!("CookDB Rust server listening on http://{}", bind_addr);

    axum::serve(listener, app).await?;

    Ok(())
}
