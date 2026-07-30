use anyhow::{Context, Result};
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::State,
    http::{
        Request, StatusCode,
        header::{CONTENT_TYPE, RETRY_AFTER},
    },
    response::{IntoResponse, Response},
    routing::{get, post},
};
use probe_client::measure_url;
use probe_core::{
    Config, MAX_CONFIGURED_INFLIGHT, MeasureRequest, PROBE_MEASUREMENT_TIMEOUT_MS,
    PROBE_PROTOCOL_VERSION, PROBE_TRANSPORT_MAX_PAYLOAD_BYTES, ProbeCapabilities,
    ProbeImplementation, ProbeLimits, ProbeMeasurementResponse, ProbeRuntimeProvenance,
    timestamp_is_valid, verify_request_signature,
};
use std::{
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream, ToSocketAddrs},
    sync::Arc,
    time::Duration,
};
use tokio::{net::TcpListener, sync::Semaphore};
use tower_http::trace::TraceLayer;
use tracing::{Level, debug, info, warn};

const HEALTHCHECK_TIMEOUT: Duration = Duration::from_secs(3);
const HEALTH_STATUS_PREFIX: &[u8] = b"HTTP/1.1 200";
const HEALTH_STATUS_PREFIX_ALT: &[u8] = b"HTTP/1.0 200";
const HEALTHCHECK_STATUS_PREFIX_BYTES: usize = HEALTH_STATUS_PREFIX.len();
const REQUEST_BUFFER_BUDGET_BYTES: usize = 64 * 1_024 * 1_024;
const MAX_REQUEST_BODY_SLOTS: usize =
    REQUEST_BUFFER_BUDGET_BYTES / PROBE_TRANSPORT_MAX_PAYLOAD_BYTES;
const REQUEST_BODY_TIMEOUT: Duration = Duration::from_secs(8);
const _: () = assert!(HEALTH_STATUS_PREFIX.len() == HEALTH_STATUS_PREFIX_ALT.len());
const _: () = assert!(MAX_REQUEST_BODY_SLOTS > 0);

#[derive(Clone)]
pub struct AppState {
    config: Arc<Config>,
    request_body_slots: Arc<Semaphore>,
    measurement_slots: Arc<Semaphore>,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        assert!(
            (1..=MAX_CONFIGURED_INFLIGHT).contains(&config.max_inflight),
            "max_inflight must be within the public configuration bounds"
        );
        let request_body_slots = Arc::new(Semaphore::new(
            config.max_inflight.min(MAX_REQUEST_BODY_SLOTS),
        ));
        let measurement_slots = Arc::new(Semaphore::new(config.max_inflight));
        Self {
            config: Arc::new(config),
            request_body_slots,
            measurement_slots,
        }
    }

    fn provenance(&self) -> ProbeRuntimeProvenance {
        ProbeRuntimeProvenance {
            implementation: ProbeImplementation::Rust,
            version: self.config.runtime_version.clone(),
            image_digest: self.config.image_digest.clone(),
        }
    }
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(handle_healthz))
        .route("/capabilities", get(handle_capabilities))
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

pub fn run_local_healthcheck(listen_addr: &str) -> Result<()> {
    let configured_addr = listen_addr
        .to_socket_addrs()
        .with_context(|| format!("probe healthcheck: failed to resolve {listen_addr}"))?
        .next()
        .with_context(|| format!("probe healthcheck: {listen_addr} did not resolve"))?;
    let connect_addr = SocketAddr::new(
        match configured_addr.ip() {
            IpAddr::V4(address) if address.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
            IpAddr::V6(address) if address.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
            address => address,
        },
        configured_addr.port(),
    );
    let mut stream = TcpStream::connect_timeout(&connect_addr, HEALTHCHECK_TIMEOUT)
        .with_context(|| format!("probe healthcheck: failed to connect to {connect_addr}"))?;
    stream
        .set_read_timeout(Some(HEALTHCHECK_TIMEOUT))
        .context("probe healthcheck: failed to set read timeout")?;
    stream
        .set_write_timeout(Some(HEALTHCHECK_TIMEOUT))
        .context("probe healthcheck: failed to set write timeout")?;
    stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .context("probe healthcheck: failed to write request")?;

    let mut response_prefix = [0_u8; HEALTHCHECK_STATUS_PREFIX_BYTES];
    let mut bytes_read = 0;
    while bytes_read < response_prefix.len() {
        let count = stream
            .read(&mut response_prefix[bytes_read..])
            .context("probe healthcheck: failed to read response")?;
        if count == 0 {
            anyhow::bail!("probe healthcheck: connection closed before HTTP status");
        }
        bytes_read += count;
    }

    if response_prefix != HEALTH_STATUS_PREFIX && response_prefix != HEALTH_STATUS_PREFIX_ALT {
        anyhow::bail!(
            "probe healthcheck returned unexpected status prefix: {}",
            String::from_utf8_lossy(&response_prefix)
        );
    }

    Ok(())
}

async fn handle_healthz(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "ok": true,
        "region": state.config.region_id,
        "probeImpl": ProbeImplementation::Rust,
    }))
}

async fn handle_capabilities(State(state): State<AppState>) -> impl IntoResponse {
    Json(ProbeCapabilities {
        protocol_version: PROBE_PROTOCOL_VERSION,
        region: state.config.region_id.clone(),
        provenance: state.provenance(),
        limits: ProbeLimits {
            max_inflight: state.config.max_inflight,
            max_payload_bytes: PROBE_TRANSPORT_MAX_PAYLOAD_BYTES,
            measurement_timeout_ms: PROBE_MEASUREMENT_TIMEOUT_MS,
        },
    })
}

async fn handle_measure(State(state): State<AppState>, request: Request<Body>) -> Response {
    let request_body_slot = match state.request_body_slots.clone().try_acquire_owned() {
        Ok(slot) => slot,
        Err(_) => return capacity_exhausted_response(),
    };
    let body_bytes = match tokio::time::timeout(
        REQUEST_BODY_TIMEOUT,
        to_bytes(request.into_body(), PROBE_TRANSPORT_MAX_PAYLOAD_BYTES),
    )
    .await
    {
        Ok(Ok(body)) => body,
        Ok(Err(_)) => {
            debug!("probe request body read failed");
            return plain_text_response(StatusCode::BAD_REQUEST, "invalid request body");
        }
        Err(_) => {
            warn!(
                timeout_ms = REQUEST_BODY_TIMEOUT.as_millis(),
                "probe request body read timed out"
            );
            return plain_text_response(StatusCode::REQUEST_TIMEOUT, "request body timeout");
        }
    };

    let body = match serde_json::from_slice::<MeasureRequest>(&body_bytes) {
        Ok(body) => body,
        Err(_) => return plain_text_response(StatusCode::BAD_REQUEST, "invalid request body"),
    };
    // MeasureRequest owns its fields, so release the raw buffer before validation and execution.
    drop(body_bytes);

    if !body.is_contract_valid() {
        return plain_text_response(StatusCode::BAD_REQUEST, "invalid request body");
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

    if body.region != state.config.region_id {
        return plain_text_response(StatusCode::BAD_REQUEST, "region does not match probe");
    }
    drop(request_body_slot);

    let _measurement_slot = match state.measurement_slots.clone().try_acquire_owned() {
        Ok(slot) => slot,
        Err(_) => return capacity_exhausted_response(),
    };

    let measurement = measure_url(&state.config.region_id, &body.url, body.request.as_ref()).await;
    info!(
        probe_impl = "rust",
        region = %state.config.region_id,
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
        Json(ProbeMeasurementResponse {
            job_id: Some(body.job_id),
            target_id: Some(body.target_id),
            provenance: Some(state.provenance()),
            measurement,
        }),
    )
        .into_response()
}

fn plain_text_response(status: StatusCode, body: &'static str) -> Response {
    (status, body).into_response()
}

fn capacity_exhausted_response() -> Response {
    let mut response = (
        StatusCode::TOO_MANY_REQUESTS,
        [(CONTENT_TYPE, "text/plain; charset=utf-8")],
        "probe capacity exhausted",
    )
        .into_response();
    response.headers_mut().insert(
        RETRY_AFTER,
        (PROBE_MEASUREMENT_TIMEOUT_MS / 1_000).max(1).into(),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::{AppState, MAX_REQUEST_BODY_SLOTS, run_local_healthcheck};
    use probe_core::{Config, MAX_CONFIGURED_INFLIGHT};
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener as StdTcpListener,
        thread,
    };

    #[test]
    fn local_healthcheck_connects_to_an_unspecified_listen_address() {
        let listener = StdTcpListener::bind("127.0.0.1:0").expect("bind health fixture");
        let port = listener.local_addr().expect("fixture address").port();
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept health request");
            let mut request = [0_u8; 128];
            let bytes_read = socket.read(&mut request).expect("read health request");
            assert!(String::from_utf8_lossy(&request[..bytes_read]).starts_with("GET /healthz "));
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
                .expect("write health response");
        });

        run_local_healthcheck(&format!("0.0.0.0:{port}")).expect("healthcheck succeeds");
        server.join().expect("health fixture exits");
    }

    #[test]
    fn local_healthcheck_rejects_a_connection_closed_before_status() {
        let listener = StdTcpListener::bind("127.0.0.1:0").expect("bind health fixture");
        let address = listener.local_addr().expect("fixture address");
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept health request");
            let mut reader = BufReader::new(&mut socket);
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("read health request");
                if line == "\r\n" {
                    break;
                }
            }
        });

        let error = run_local_healthcheck(&address.to_string()).expect_err("healthcheck fails");
        assert!(
            error
                .to_string()
                .contains("connection closed before HTTP status")
        );
        server.join().expect("health fixture exits");
    }

    #[test]
    fn measurement_slots_fail_fast_at_the_configured_limit() {
        let state = AppState::new(Config {
            listen_addr: "127.0.0.1:0".to_string(),
            region_id: "local".to_string(),
            shared_secret: "test-probe-secret".to_string(),
            shared_secret_next: None,
            max_inflight: 1,
            runtime_version: None,
            image_digest: None,
        });
        let first = state
            .measurement_slots
            .clone()
            .try_acquire_owned()
            .expect("first slot should be available");

        assert!(state.measurement_slots.clone().try_acquire_owned().is_err());

        drop(first);
        assert!(state.measurement_slots.clone().try_acquire_owned().is_ok());
    }

    #[test]
    fn request_body_slots_have_a_fixed_memory_budget() {
        let state = AppState::new(Config {
            listen_addr: "127.0.0.1:0".to_string(),
            region_id: "local".to_string(),
            shared_secret: "test-probe-secret".to_string(),
            shared_secret_next: None,
            max_inflight: MAX_CONFIGURED_INFLIGHT,
            runtime_version: None,
            image_digest: None,
        });
        let permits = state
            .request_body_slots
            .clone()
            .try_acquire_many_owned(
                u32::try_from(MAX_REQUEST_BODY_SLOTS)
                    .expect("request body slot limit should fit in u32"),
            )
            .expect("the fixed request body budget should be available");

        assert!(
            state
                .request_body_slots
                .clone()
                .try_acquire_owned()
                .is_err()
        );
        assert_eq!(
            state.measurement_slots.available_permits(),
            MAX_CONFIGURED_INFLIGHT
        );

        drop(permits);
        assert!(state.request_body_slots.clone().try_acquire_owned().is_ok());
    }
}
