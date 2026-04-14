use chrono::{DateTime, Duration, SecondsFormat, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;
use std::{
    env,
    net::{IpAddr, Ipv4Addr},
};
use subtle::ConstantTimeEq;
use thiserror::Error;
use url::Url;

type HmacSha256 = Hmac<Sha256>;

const DEFAULT_LISTEN_ADDR: &str = "0.0.0.0:8080";
const DEFAULT_REGION_CODE: &str = "tokyo";
const DEFAULT_SHARED_SECRET: &str = "dev-shared-secret";

#[derive(Debug, Clone)]
pub struct Config {
    pub listen_addr: String,
    pub region_code: String,
    pub shared_secret: String,
    pub shared_secret_next: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            listen_addr: env::var("PROBE_LISTEN_ADDR")
                .unwrap_or_else(|_| DEFAULT_LISTEN_ADDR.to_string()),
            region_code: env::var("REGION_CODE")
                .unwrap_or_else(|_| DEFAULT_REGION_CODE.to_string()),
            shared_secret: env::var("PROBE_SHARED_SECRET")
                .unwrap_or_else(|_| DEFAULT_SHARED_SECRET.to_string()),
            shared_secret_next: env::var("PROBE_SHARED_SECRET_NEXT")
                .ok()
                .filter(|value| !value.is_empty()),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProbeImplementation {
    Go,
    Rust,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeTimings {
    pub total_ms: u64,
    pub dns_ms: Option<u64>,
    pub tcp_ms: Option<u64>,
    pub tls_ms: Option<u64>,
    pub ttfb_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeTlsMetadata {
    pub version: Option<String>,
    pub alpn: Option<String>,
    pub cipher_suite: Option<String>,
    pub server_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeMeasurement {
    pub region: String,
    pub url: String,
    pub latency_ms: u64,
    pub measured_at: String,
    pub status_code: Option<u16>,
    pub success: bool,
    pub probe_impl: ProbeImplementation,
    pub final_url: Option<String>,
    pub redirect_count: u32,
    pub timings: ProbeTimings,
    pub tls: Option<ProbeTlsMetadata>,
    pub error: Option<String>,
}

impl ProbeMeasurement {
    pub fn failure(
        region: impl Into<String>,
        url: impl Into<String>,
        final_url: Option<String>,
        redirect_count: u32,
        timings: ProbeTimings,
        error: impl Into<String>,
    ) -> Self {
        Self {
            region: region.into(),
            url: url.into(),
            latency_ms: timings.total_ms,
            measured_at: utc_timestamp(),
            status_code: None,
            success: false,
            probe_impl: ProbeImplementation::Rust,
            final_url,
            redirect_count,
            timings,
            tls: None,
            error: Some(error.into()),
        }
    }
}

pub fn utc_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProbeMeasurementResponse {
    pub measurement: ProbeMeasurement,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeasureRequest {
    pub job_id: String,
    pub target_id: String,
    pub region: String,
    pub url: String,
    #[serde(default)]
    pub request: Option<RequestConfig>,
    pub timestamp: String,
    pub signature: String,
    #[serde(default = "default_key_version")]
    pub key_version: String,
}

impl MeasureRequest {
    pub fn has_required_fields(&self) -> bool {
        !self.job_id.is_empty()
            && !self.target_id.is_empty()
            && !self.region.is_empty()
            && !self.url.is_empty()
            && !self.timestamp.is_empty()
            && !self.signature.is_empty()
    }
}

fn default_key_version() -> String {
    "current".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestBody {
    pub mode: String,
    pub content_type: Option<String>,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestConfig {
    pub method: String,
    #[serde(default)]
    pub headers: Vec<RequestHeader>,
    pub body: Option<RequestBody>,
}

impl Default for RequestConfig {
    fn default() -> Self {
        Self {
            method: "GET".to_string(),
            headers: Vec::new(),
            body: None,
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TargetValidationError {
    #[error("target url is required")]
    MissingTargetUrl,
    #[error("only http and https urls are allowed")]
    InvalidScheme,
    #[error("credentials in urls are not allowed")]
    EmbeddedCredentials,
    #[error("only ports 80 and 443 are allowed")]
    InvalidPort,
    #[error("private or local hostnames are blocked")]
    PrivateHostname,
    #[error("private or link-local ips are blocked")]
    PrivateIpLiteral,
}

pub fn sign_request(secret: &str, request: &MeasureRequest) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC key length should be valid");
    mac.update(signature_payload(request).as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

pub fn verify_request_signature(
    current_secret: &str,
    next_secret: Option<&str>,
    request: &MeasureRequest,
) -> bool {
    let current = sign_request(current_secret, request);

    if current
        .as_bytes()
        .ct_eq(request.signature.as_bytes())
        .into()
    {
        return true;
    }

    next_secret
        .map(|secret| sign_request(secret, request))
        .is_some_and(|expected| {
            expected
                .as_bytes()
                .ct_eq(request.signature.as_bytes())
                .into()
        })
}

pub fn signature_payload(request: &MeasureRequest) -> String {
    let normalized_request = request.request.clone().unwrap_or_default();
    let mut headers = normalized_request
        .headers
        .into_iter()
        .map(|header| json!({
            "name": header.name.trim().to_ascii_lowercase(),
            "value": header.value.trim(),
        }))
        .collect::<Vec<_>>();
    headers.sort_by(|left, right| {
        let left_name = left.get("name").and_then(|value| value.as_str()).unwrap_or_default();
        let right_name = right
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or_default();

        if left_name == right_name {
            let left_value = left
                .get("value")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            let right_value = right
                .get("value")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            return left_value.cmp(right_value);
        }

        left_name.cmp(right_name)
    });

    json!({
        "jobId": request.job_id,
        "targetId": request.target_id,
        "region": request.region,
        "url": request.url,
        "request": {
            "method": normalized_request.method,
            "headers": headers,
            "body": normalized_request.body.as_ref().map(|body| json!({
                "mode": body.mode,
                "contentType": body.content_type,
                "value": body.value,
            })),
        },
        "timestamp": request.timestamp,
    })
    .to_string()
}

pub fn timestamp_is_valid(value: &str, now: DateTime<Utc>) -> Result<bool, chrono::ParseError> {
    let requested_at = DateTime::parse_from_rfc3339(value)?.with_timezone(&Utc);
    Ok(requested_at >= now - Duration::minutes(5) && requested_at <= now + Duration::minutes(1))
}

pub fn validate_target_url(url: &Url) -> Result<(), TargetValidationError> {
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err(TargetValidationError::InvalidScheme),
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err(TargetValidationError::EmbeddedCredentials);
    }

    if let Some(port) = url.port()
        && port != 80
        && port != 443
    {
        return Err(TargetValidationError::InvalidPort);
    }

    let hostname = url
        .host_str()
        .ok_or(TargetValidationError::MissingTargetUrl)?
        .to_ascii_lowercase();

    if hostname == "localhost"
        || hostname.ends_with(".localhost")
        || hostname.ends_with(".local")
        || hostname.ends_with(".internal")
    {
        return Err(TargetValidationError::PrivateHostname);
    }

    if let Ok(ip) = hostname.parse::<IpAddr>()
        && is_private_ip(ip)
    {
        return Err(TargetValidationError::PrivateIpLiteral);
    }

    Ok(())
}

pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            ipv4.is_loopback()
                || ipv4.is_private()
                || ipv4.is_link_local()
                || ipv4.is_multicast()
                || ipv4.is_unspecified()
                || is_shared_address_space(ipv4)
                || is_benchmarking_range(ipv4)
        }
        IpAddr::V6(ipv6) => {
            ipv6.is_loopback()
                || ipv6.is_multicast()
                || ipv6.is_unspecified()
                || ipv6.is_unique_local()
                || ipv6.is_unicast_link_local()
        }
    }
}

fn is_shared_address_space(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

fn is_benchmarking_range(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 198 && matches!(octets[1], 18 | 19)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_request() -> MeasureRequest {
        MeasureRequest {
            job_id: "job_1".to_string(),
            target_id: "job_1:tokyo".to_string(),
            region: "tokyo".to_string(),
            url: "https://example.com".to_string(),
            request: None,
            timestamp: "2026-04-07T00:00:00Z".to_string(),
            signature: String::new(),
            key_version: "current".to_string(),
        }
    }

    #[test]
    fn signs_requests_with_expected_payload() {
        let request = sample_request();
        let signature = sign_request("secret", &request);
        assert!(!signature.is_empty());
        assert!(verify_request_signature(
            "secret",
            None,
            &MeasureRequest {
                signature,
                ..request
            }
        ));
    }

    #[test]
    fn rejects_private_ipv4_literals() {
        let url = Url::parse("http://127.0.0.1").expect("url should parse");
        assert_eq!(
            validate_target_url(&url),
            Err(TargetValidationError::PrivateIpLiteral)
        );
    }

    #[test]
    fn signature_payload_changes_with_request_config() {
        let mut request = sample_request();
        let baseline = signature_payload(&request);
        request.request = Some(RequestConfig {
            method: "POST".to_string(),
            headers: vec![RequestHeader {
                name: "X-Test".to_string(),
                value: "true".to_string(),
            }],
            body: Some(RequestBody {
                mode: "text".to_string(),
                content_type: Some("text/plain".to_string()),
                value: "hello".to_string(),
            }),
        });

        assert_ne!(baseline, signature_payload(&request));
    }
}
