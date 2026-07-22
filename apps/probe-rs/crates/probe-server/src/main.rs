use anyhow::Result;
use probe_core::Config;
use probe_server::{AppState, run_local_healthcheck, serve};
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{EnvFilter, fmt};

#[tokio::main]
async fn main() -> Result<()> {
    if std::env::args().nth(1).as_deref() == Some("--healthcheck") {
        return run_local_healthcheck(
            &std::env::var("PROBE_LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string()),
        );
    }

    init_tracing();

    let config = Config::from_env()?;
    let state = AppState::new(config.clone());
    let listener = TcpListener::bind(&config.listen_addr).await?;

    info!(
        probe_impl = "rust",
        listen_addr = %config.listen_addr,
        region = %config.region_code,
        "probe starting"
    );

    serve(listener, state).await
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    fmt()
        .json()
        .with_env_filter(filter)
        .with_current_span(false)
        .with_span_list(false)
        .init();
}
