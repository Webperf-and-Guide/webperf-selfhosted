use anyhow::Result;
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::State,
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use probe_client::{build_client, measure_url};
use probe_core::{
    Config, MeasureRequest, ProbeImplementation, ProbeMeasurementResponse, timestamp_is_valid,
    verify_request_signature,
};
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::trace::TraceLayer;
use tracing::{Level, info};

const MAX_BODY_SIZE_BYTES: usize = 32 * 1024;

#[derive(Clone)]
pub struct AppState {
    config: Arc<Config>,
    client: reqwest::Client,
}

impl AppState {
    pub fn new(config: Config) -> Result<Self> {
        Ok(Self {
            config: Arc::new(config),
            client: build_client()?,
        })
    }
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(handle_healthz))
        .route("/measure", post(handle_measure))
        .with_state(state)
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request<Body>| {
                tracing::span!(
                    Level::INFO,
                    "http_request",
                    method = %request.method(),
                    path = %request.uri().path()
                )
            }),
        )
}

pub async fn serve(listener: TcpListener, state: AppState) -> Result<()> {
    axum::serve(listener, app(state)).await?;
    Ok(())
}

async fn handle_healthz(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "ok": true,
        "region": state.config.region_code,
        "probeImpl": ProbeImplementation::Rust,
    }))
}

async fn handle_measure(State(state): State<AppState>, request: Request<Body>) -> Response {
    let body_bytes = match to_bytes(request.into_body(), MAX_BODY_SIZE_BYTES).await {
        Ok(body) => body,
        Err(_) => return plain_text_response(StatusCode::BAD_REQUEST, "invalid request body"),
    };

    let body = match serde_json::from_slice::<MeasureRequest>(&body_bytes) {
        Ok(body) => body,
        Err(_) => return plain_text_response(StatusCode::BAD_REQUEST, "invalid request body"),
    };

    if !body.has_required_fields() {
        return plain_text_response(
            StatusCode::BAD_REQUEST,
            "jobId, targetId, region, url, timestamp, and signature are required",
        );
    }

    let timestamp_valid = match timestamp_is_valid(&body.timestamp, chrono::Utc::now()) {
        Ok(valid) => valid,
        Err(_) => return plain_text_response(StatusCode::BAD_REQUEST, "invalid timestamp"),
    };

    if !timestamp_valid {
        return plain_text_response(StatusCode::UNAUTHORIZED, "timestamp expired");
    }

    if !verify_request_signature(
        &state.config.shared_secret,
        state.config.shared_secret_next.as_deref(),
        &body,
    ) {
        return plain_text_response(StatusCode::UNAUTHORIZED, "invalid signature");
    }

    let measurement = measure_url(
        &state.client,
        &state.config.region_code,
        &body.url,
        body.request.as_ref(),
    )
    .await;
    info!(
        probe_impl = "rust",
        region = %state.config.region_code,
        target_id = %body.target_id,
        request_method = %body.request.as_ref().map(|request| request.method.as_str()).unwrap_or("GET"),
        status_code = ?measurement.status_code,
        redirect_count = measurement.redirect_count,
        total_ms = measurement.timings.total_ms,
        dns_ms = ?measurement.timings.dns_ms,
        tcp_ms = ?measurement.timings.tcp_ms,
        tls_ms = ?measurement.timings.tls_ms,
        ttfb_ms = ?measurement.timings.ttfb_ms,
        final_url = ?measurement.final_url,
        success = measurement.success,
        error = ?measurement.error,
        "probe measurement complete"
    );

    (
        StatusCode::OK,
        Json(ProbeMeasurementResponse { measurement }),
    )
        .into_response()
}

fn plain_text_response(status: StatusCode, body: &'static str) -> Response {
    (status, body).into_response()
}
