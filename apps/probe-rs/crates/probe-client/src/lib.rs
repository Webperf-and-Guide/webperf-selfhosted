use anyhow::Result;
use probe_core::{
    ProbeImplementation, ProbeMeasurement, ProbeTimings, ProbeTlsMetadata, RequestConfig,
    utc_timestamp, validate_target_url,
};
use reqwest::{
    Client, Method, Url,
    header::{CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue, LOCATION},
    redirect::Policy,
};
use std::{
    net::{IpAddr, SocketAddr},
    time::{Duration, Instant},
};
use tokio::net::lookup_host;
use tracing::debug;

pub fn build_client() -> Result<Client> {
    Ok(Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(8))
        .use_rustls_tls()
        .build()?)
}

pub async fn measure_url(
    client: &Client,
    region: &str,
    target: &str,
    request_config: Option<&RequestConfig>,
) -> ProbeMeasurement {
    let started_at = Instant::now();
    let parsed = match Url::parse(target) {
        Ok(url) => url,
        Err(_) => {
            return ProbeMeasurement::failure(
                region,
                target,
                None,
                0,
                base_timings(started_at.elapsed(), None, None),
                "invalid target url",
            );
        }
    };

    if let Err(error) = validate_target_url(&parsed) {
        return ProbeMeasurement::failure(
            region,
            target,
            Some(display_url(&parsed)),
            0,
            base_timings(started_at.elapsed(), None, None),
            error.to_string(),
        );
    }

    let mut current = parsed;
    let mut redirect_count = 0_u32;
    let mut last_dns_ms = None;
    let mut last_ttfb_ms = None;

    loop {
        let dns_started_at = Instant::now();
        if let Err(message) = resolve_public_host(&current).await {
            return ProbeMeasurement::failure(
                region,
                target,
                Some(display_url(&current)),
                redirect_count,
                base_timings(
                    started_at.elapsed(),
                    last_dns_ms.or_else(|| elapsed_millis(dns_started_at)),
                    last_ttfb_ms,
                ),
                message,
            );
        }
        last_dns_ms = elapsed_millis(dns_started_at);

        let request_started_at = Instant::now();
        let request = match build_request(client, current.clone(), request_config) {
            Ok(request) => request,
            Err(error) => {
                return ProbeMeasurement::failure(
                    region,
                    target,
                    Some(display_url(&current)),
                    redirect_count,
                    base_timings(
                        started_at.elapsed(),
                        last_dns_ms,
                        elapsed_millis(request_started_at),
                    ),
                    error,
                );
            }
        };
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                return ProbeMeasurement::failure(
                    region,
                    target,
                    Some(display_url(&current)),
                    redirect_count,
                    base_timings(
                        started_at.elapsed(),
                        last_dns_ms,
                        elapsed_millis(request_started_at),
                    ),
                    error.to_string(),
                );
            }
        };
        last_ttfb_ms = elapsed_millis(request_started_at);

        if response.status().is_redirection() {
            let location = match response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
            {
                Some(location) => location,
                None => {
                    return ProbeMeasurement::failure(
                        region,
                        target,
                        Some(display_url(&current)),
                        redirect_count,
                        base_timings(started_at.elapsed(), last_dns_ms, last_ttfb_ms),
                        "redirect location missing",
                    );
                }
            };

            let next = match current.join(location) {
                Ok(next) => next,
                Err(_) => {
                    return ProbeMeasurement::failure(
                        region,
                        target,
                        Some(display_url(&current)),
                        redirect_count,
                        base_timings(started_at.elapsed(), last_dns_ms, last_ttfb_ms),
                        "redirect location missing",
                    );
                }
            };

            if let Err(error) = validate_target_url(&next) {
                return ProbeMeasurement::failure(
                    region,
                    target,
                    Some(display_url(&next)),
                    redirect_count + 1,
                    base_timings(started_at.elapsed(), last_dns_ms, last_ttfb_ms),
                    error.to_string(),
                );
            }

            redirect_count += 1;
            if redirect_count >= 4 {
                return ProbeMeasurement::failure(
                    region,
                    target,
                    Some(display_url(&next)),
                    redirect_count,
                    base_timings(started_at.elapsed(), last_dns_ms, last_ttfb_ms),
                    "too many redirects",
                );
            }

            current = next;
            continue;
        }

        let status_code = response.status().as_u16();
        debug!(url = %current, status_code, redirect_count, "probe request completed");

        return ProbeMeasurement {
            region: region.to_string(),
            url: target.to_string(),
            latency_ms: started_at.elapsed().as_millis() as u64,
            measured_at: utc_timestamp(),
            status_code: Some(status_code),
            success: status_code < 500,
            probe_impl: ProbeImplementation::Rust,
            final_url: Some(display_url(&current)),
            redirect_count,
            timings: base_timings(started_at.elapsed(), last_dns_ms, last_ttfb_ms),
            tls: tls_metadata(&current),
            error: None,
        };
    }
}

fn build_request(
    client: &Client,
    url: Url,
    request_config: Option<&RequestConfig>,
) -> Result<reqwest::RequestBuilder, String> {
    let config = request_config.cloned().unwrap_or_default();
    let method = Method::from_bytes(config.method.as_bytes())
        .map_err(|_| format!("unsupported request method: {}", config.method))?;
    let mut headers = HeaderMap::new();

    for header in config.headers {
        let name = HeaderName::from_bytes(header.name.as_bytes())
            .map_err(|_| format!("invalid request header name: {}", header.name))?;
        let value = HeaderValue::from_str(&header.value)
            .map_err(|_| format!("invalid request header value for {}", header.name))?;
        headers.append(name, value);
    }

    let mut request = client.request(method.clone(), url).headers(headers);

    if let Some(body) = config.body {
        if method == Method::GET || method == Method::HEAD {
            return Err(format!("{} requests cannot include a request body", method));
        }

        if let Some(content_type) = body.content_type {
            let header_value = HeaderValue::from_str(&content_type)
                .map_err(|_| "invalid request body content type".to_string())?;
            request = request.header(CONTENT_TYPE, header_value);
        }

        request = request.body(body.value);
    }

    Ok(request)
}

async fn resolve_public_host(url: &Url) -> Result<Vec<SocketAddr>, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "target url is required".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "only ports 80 and 443 are allowed".to_string())?;
    let addresses = lookup_host((host, port))
        .await
        .map(|entries| entries.collect::<Vec<_>>())
        .map_err(|error| error.to_string())?;

    if addresses.is_empty() {
        return Err("host did not resolve".to_string());
    }

    if addresses.iter().any(|address| is_private_ip(address.ip())) {
        return Err("resolved private or metadata ip".to_string());
    }

    Ok(addresses)
}

fn base_timings(total: Duration, dns_ms: Option<u64>, ttfb_ms: Option<u64>) -> ProbeTimings {
    ProbeTimings {
        total_ms: total.as_millis() as u64,
        dns_ms,
        tcp_ms: None,
        tls_ms: None,
        ttfb_ms,
    }
}

fn elapsed_millis(started_at: Instant) -> Option<u64> {
    Some(started_at.elapsed().as_millis() as u64)
}

fn tls_metadata(url: &Url) -> Option<ProbeTlsMetadata> {
    if url.scheme() != "https" {
        return None;
    }

    Some(ProbeTlsMetadata {
        version: None,
        alpn: None,
        cipher_suite: None,
        server_name: url.host_str().map(str::to_string),
    })
}

fn is_private_ip(ip: IpAddr) -> bool {
    probe_core::is_private_ip(ip)
}

fn display_url(url: &Url) -> String {
    if url.path() == "/" && url.query().is_none() && url.fragment().is_none() {
        let mut normalized = format!("{}://{}", url.scheme(), url.host_str().unwrap_or_default());

        if let Some(port) = url.port() {
            normalized.push(':');
            normalized.push_str(&port.to_string());
        }

        return normalized;
    }

    url.to_string()
}
