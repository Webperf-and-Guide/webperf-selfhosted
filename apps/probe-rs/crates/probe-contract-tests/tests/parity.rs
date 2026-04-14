use anyhow::Result;
use probe_core::{Config, MeasureRequest, ProbeMeasurementResponse, RequestBody, RequestConfig, RequestHeader, sign_request};
use probe_server::{AppState, serve};
use reqwest::{Client, StatusCode};
use std::{net::TcpListener, sync::OnceLock, time::Duration};
use tokio::{net::TcpListener as TokioTcpListener, time::sleep};

const SHARED_SECRET: &str = "contract-secret";
static TEST_MUTEX: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

#[tokio::test]
async fn rejects_invalid_signatures() -> Result<()> {
    let _guard = TEST_MUTEX
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let harness = Harness::start().await?;
    let request = MeasureRequest {
        signature: "bad-signature".to_string(),
        ..sample_request("https://example.com")
    };

    let response = harness.measure(&request).await?;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    Ok(())
}

#[tokio::test]
async fn rejects_expired_timestamps() -> Result<()> {
    let _guard = TEST_MUTEX
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let harness = Harness::start().await?;
    let mut request = sample_request("https://example.com");
    request.timestamp = "2020-01-01T00:00:00Z".to_string();
    request.signature = sign_request(SHARED_SECRET, &request);

    let response = harness.measure(&request).await?;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    Ok(())
}

#[tokio::test]
async fn returns_failure_measurements_for_blocked_private_targets() -> Result<()> {
    let _guard = TEST_MUTEX
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let harness = Harness::start().await?;
    let request = signed_request("http://127.0.0.1/private");

    let measurement = harness.measure_json(&request).await?.measurement;

    assert!(!measurement.success);
    assert_eq!(measurement.status_code, None);
    assert_eq!(
        measurement.probe_impl,
        probe_core::ProbeImplementation::Rust
    );
    assert!(measurement.error.is_some());
    Ok(())
}

#[tokio::test]
async fn follows_redirects_to_terminal_response() -> Result<()> {
    let _guard = TEST_MUTEX
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let harness = Harness::start().await?;
    let request = signed_request("http://github.com");

    let measurement = harness.measure_json(&request).await?.measurement;

    assert_eq!(measurement.url, "http://github.com");
    assert!(measurement.redirect_count >= 1);
    assert!(measurement.final_url.is_some());
    assert!(measurement.status_code.is_some());
    Ok(())
}

#[tokio::test]
async fn returns_expanded_measurement_payload_for_success() -> Result<()> {
    let _guard = TEST_MUTEX
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let harness = Harness::start().await?;
    let request = signed_request("http://example.com");

    let measurement = harness.measure_json(&request).await?.measurement;

    assert_eq!(measurement.url, "http://example.com");
    assert_eq!(measurement.final_url.as_deref(), Some("http://example.com"));
    assert_eq!(
        measurement.probe_impl,
        probe_core::ProbeImplementation::Rust
    );
    assert_eq!(measurement.redirect_count, 0);
    assert!(measurement.latency_ms > 0);
    assert!(measurement.timings.total_ms > 0);
    Ok(())
}

#[tokio::test]
async fn accepts_custom_request_configuration() -> Result<()> {
    let _guard = TEST_MUTEX
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let harness = Harness::start().await?;
    let mut request = sample_request("http://example.com");
    request.request = Some(RequestConfig {
        method: "POST".to_string(),
        headers: vec![RequestHeader {
            name: "x-test-mode".to_string(),
            value: "contract".to_string(),
        }],
        body: Some(RequestBody {
            mode: "text".to_string(),
            content_type: Some("text/plain".to_string()),
            value: "hello from contract".to_string(),
        }),
    });
    request.signature = sign_request(SHARED_SECRET, &request);

    let response = harness.measure(&request).await?;
    assert_eq!(response.status(), StatusCode::OK);
    Ok(())
}

struct Harness {
    client: Client,
    base_url: String,
    rust_task: tokio::task::JoinHandle<()>,
}

impl Harness {
    async fn start() -> Result<Self> {
        let client = Client::builder().timeout(Duration::from_secs(15)).build()?;
        let port = open_port()?;
        let config = Config {
            listen_addr: format!("127.0.0.1:{port}"),
            region_code: "tokyo".to_string(),
            shared_secret: SHARED_SECRET.to_string(),
            shared_secret_next: None,
        };

        let listener = TokioTcpListener::bind(&config.listen_addr).await?;
        let state = AppState::new(config)?;
        let rust_task = tokio::spawn(async move {
            let _ = serve(listener, state).await;
        });

        let base_url = format!("http://127.0.0.1:{port}");
        wait_for_health(&client, &base_url).await?;

        Ok(Self {
            client,
            base_url,
            rust_task,
        })
    }

    async fn measure(&self, request: &MeasureRequest) -> Result<reqwest::Response> {
        Ok(self
            .client
            .post(format!("{}/measure", self.base_url))
            .json(request)
            .send()
            .await?)
    }

    async fn measure_json(&self, request: &MeasureRequest) -> Result<ProbeMeasurementResponse> {
        let response = self.measure(request).await?;
        assert_eq!(response.status(), StatusCode::OK);
        Ok(response.json::<ProbeMeasurementResponse>().await?)
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        self.rust_task.abort();
    }
}

fn sample_request(target: &str) -> MeasureRequest {
    MeasureRequest {
        job_id: "job_1".to_string(),
        target_id: "job_1:tokyo".to_string(),
        region: "tokyo".to_string(),
        url: target.to_string(),
        request: None,
        timestamp: chrono::Utc::now().to_rfc3339(),
        signature: String::new(),
        key_version: "current".to_string(),
    }
}

fn signed_request(target: &str) -> MeasureRequest {
    let mut request = sample_request(target);
    request.signature = sign_request(SHARED_SECRET, &request);
    request
}

async fn wait_for_health(client: &Client, base_url: &str) -> Result<()> {
    for _ in 0..120 {
        if let Ok(response) = client.get(format!("{base_url}/healthz")).send().await
            && response.status().is_success()
        {
            return Ok(());
        }

        sleep(Duration::from_millis(250)).await;
    }

    anyhow::bail!("timed out waiting for {base_url} to become healthy")
}

fn open_port() -> Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}
