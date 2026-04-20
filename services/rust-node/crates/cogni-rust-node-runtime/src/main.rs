use cogni_rust_node_runtime::app::{AppState, RuntimeConfig, router};
use tokio::net::TcpListener;
use tracing_subscriber::{EnvFilter, fmt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    fmt().json().with_env_filter(filter).init();

    let config = RuntimeConfig::from_env();
    let address = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&address).await?;
    tracing::info!(event = "rust_node.started", address, version = ?config.version, "rust node runtime started");
    axum::serve(listener, router(AppState::new(config))).await?;
    Ok(())
}
