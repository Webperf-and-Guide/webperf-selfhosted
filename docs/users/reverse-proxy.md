# Reverse proxy and remote access

The safe ingress boundary is the console on `127.0.0.1:5173`. The console
server proxies authenticated API requests internally. Do not route external
traffic directly to the API, scheduler, executor, probe, Browser Audit runner,
or debug proxies.

## Required controls

- Keep the Compose console binding on loopback.
- Terminate TLS at a maintained reverse proxy.
- Add authentication or private-network access in front of every console path.
- Preserve the external `Host`, client address, and `X-Forwarded-Proto`.
- Disable response buffering for the live event stream and allow a long read
  timeout.
- Apply request/body limits and rate controls appropriate for operator use.
- Set `CONSOLE_ORIGIN` to the exact external HTTPS origin and recreate the
  console service.

An identity-aware proxy, VPN/overlay network, or HTTP Basic Auth can provide
the additional access layer. These are deployment choices and must not become
runtime dependencies of WebPerf core.

## Nginx shape

The following shows the intended routing boundary. Supply organization-managed
certificates and a password file; review the exact directives against the
installed Nginx version.

```nginx
server {
    listen 443 ssl;
    server_name webperf.example.com;

    ssl_certificate     /etc/ssl/webperf/fullchain.pem;
    ssl_certificate_key /etc/ssl/webperf/privkey.pem;

    auth_basic "WebPerf operators";
    auth_basic_user_file /etc/nginx/webperf.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

There should be no location forwarding to ports `8788`, `8080`, or `8081`.
Never put `SELFHOST_ADMIN_TOKEN` into a response header or browser cookie; the
console already holds it server-side.

## Apply and verify

```dotenv
CONSOLE_ORIGIN=https://webperf.example.com
```

```sh
docker compose --env-file .env -f compose.yml up -d console
curl --fail http://127.0.0.1:5173/
curl --fail --user operator https://webperf.example.com/
```

Verify an unauthenticated remote request is challenged by the additional
access layer, TLS renewal is monitored, the live Run stream is not buffered,
and the API cannot be reached directly from the internet.
