# Deployment Guide

SavannaGuard Community is designed for self-hosting with a single server
process and SQLite storage. Docker Compose is the recommended production path.

## Environment Variables

| Variable | Required | Default | Description |
|---|---:|---|---|
| `SECRET_KEY` | Yes | - | Token signing/encryption secret. Use `openssl rand -hex 32`. |
| `ADMIN_PASSWORD` | Yes | - | Admin dashboard password. Docker Compose requires it; production rejects `admin`. |
| `ADMIN_SESSION_TTL_MS` | No | `43200000` | Admin session lifetime in milliseconds. |
| `PORT` | No | `3000` | Published HTTP port. |
| `HOST` | No | `0.0.0.0` | Bind address. Use `0.0.0.0` in containers. |
| `DB_PATH` | No | `./data/savannaguard.db` | SQLite path. Docker uses `/data/savannaguard.db`. |
| `BODY_LIMIT_BYTES` | No | `131072` | Max accepted public challenge/token API request body size. |
| `LOG_LEVEL` | No | `info` | Logging verbosity. |
| `TRUST_PROXY` | No | `false` | Trust `X-Forwarded-*` headers from a controlled proxy. |
| `SECURITY_HEADERS_ENABLED` | No | `true` | Emits baseline browser security headers and CSP. |
| `CORS_ALLOWED_ORIGINS` | No | `*` | Browser origins allowed to call public challenge/token endpoints. |
| `TOKEN_SINGLE_USE` | No | `true` | Reject replayed verdict tokens after first validation. |
| `ADAPTIVE_MIN_SAMPLES` | No | `10` | Human samples required before adaptive scoring affects results. |
| `PASSIVE_PROTECTION_ENABLED` | No | `true` | Enables passive IP checks and datacenter rate limiting. |
| `PASSIVE_PROTECTION_BLOCK_DC` | No | `false` | Blocks known datacenter IPs instead of rate limiting them. |
| `PASSIVE_PROTECTION_DC_RATE_LIMIT` | No | `3` | Per-minute challenge limit for datacenter IPs. |
| `PASSIVE_PROTECTION_CUSTOM_RANGES` | No | - | Extra CIDR ranges treated as datacenter candidates. |
| `FEDERATION_ENABLED` | No | `false` | Enables peer-to-peer signature sync. |
| `FEDERATION_PEERS` | No | - | Comma-separated peer URLs. |
| `FEDERATION_PSK` | No | - | Default pre-shared key for federation. |
| `FEDERATION_SYNC_INTERVAL` | No | `300000` | Active peer sync interval in ms. |
| `FEDERATION_OFFLINE_SYNC_INTERVAL` | No | `1800000` | Offline peer recovery interval in ms. |
| `FEDERATION_OFFLINE_THRESHOLD` | No | `3` | Failures before a peer is marked offline. |
| `FEDERATION_MAX_PAYLOAD_BYTES` | No | `5242880` | Max federation payload size. |
| `FEDERATION_REQUEST_TIMEOUT_MS` | No | `30000` | Peer request timeout. |
| `FEDERATION_MAX_RETRIES` | No | `3` | Retry attempts per peer request. |
| `FEDERATION_BASE_RETRY_DELAY_MS` | No | `5000` | Base retry delay. |
| `FEDERATION_MAX_RETRY_DELAY_MS` | No | `60000` | Max retry delay. |
| `FEDERATION_ALLOW_PRIVATE_PEERS` | No | `false` | Allows private/internal peer hostnames for Docker/VPN setups. |

## Docker Compose

```bash
git clone https://github.com/etherman-os/SavannaGuard
cd SavannaGuard
cp .env.example .env
```

Edit `.env` before starting:

```bash
SECRET_KEY=$(openssl rand -hex 32)
ADMIN_PASSWORD=replace-with-a-strong-password
```

Start the service:

```bash
docker compose up -d --build
```

Open:

- API: `http://localhost:3000/api/v1/`
- Admin: `http://localhost:3000/admin`
- Health: `http://localhost:3000/health`

The Compose file stores SQLite data in the `savannaguard_data` volume mounted at
`/data`.

## Docker Run

```bash
docker build -t savannaguard .
docker run -d \
  --name savannaguard \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e SECRET_KEY="$(openssl rand -hex 32)" \
  -e ADMIN_PASSWORD="replace-with-a-strong-password" \
  -e DB_PATH=/data/savannaguard.db \
  -v savannaguard-data:/data \
  savannaguard
```

## Without Docker

```bash
pnpm install
pnpm build
cp .env.example .env
pnpm --filter @savannaguard/server start
```

Set `SECRET_KEY` and `ADMIN_PASSWORD` in `.env` before exposing the service.

## Reverse Proxy

Terminate TLS at a reverse proxy and forward traffic to SavannaGuard.

```nginx
server {
    listen 443 ssl http2;
    server_name savanna.example.com;

    ssl_certificate /etc/ssl/certs/savanna.crt;
    ssl_certificate_key /etc/ssl/private/savanna.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Use HTTPS before enabling secure production cookies. If your deployment relies on
client IP based protections, make sure your proxy preserves the real client IP
and set `TRUST_PROXY=true` only when the proxy is controlled by you.

## Browser Origins

The widget can be hosted from the SavannaGuard server and embedded on another
site. Browsers require CORS for the widget's `fetch()` calls to the public API.

The default `CORS_ALLOWED_ORIGINS=*` works for quick setup because the public
challenge/token endpoints do not use cookies. In production, restrict it to the
frontend origins that embed the widget:

```bash
CORS_ALLOWED_ORIGINS=https://example.com,https://www.example.com
```

Admin and federation endpoints do not receive browser CORS headers.

## Federation

Federation is optional. Keep it disabled until you have trusted peers.

For public peers:

- Use `https://` peer URLs.
- Configure a strong PSK.
- Add peers through `/admin/federation` or `POST /admin/api/federation/peers`.

For Docker, VPN, or private networks:

- Set `FEDERATION_ALLOW_PRIVATE_PEERS=true`.
- Private/internal hosts may use HTTP, but public hosts still require HTTPS.
- Do not add peers you do not control or trust.

## Backups

Back up the SQLite database and WAL files together when the service is running:

- `/data/savannaguard.db`
- `/data/savannaguard.db-wal`
- `/data/savannaguard.db-shm`

For low-traffic deployments, a scheduled volume snapshot is usually enough. For
busy deployments, stop the container briefly or use SQLite's online backup tools.

## Production Checklist

- [ ] `SECRET_KEY` is set to a random value from `openssl rand -hex 32`.
- [ ] `ADMIN_PASSWORD` is not `admin` and is not shared with other systems.
- [ ] HTTPS is enabled at the reverse proxy.
- [ ] `CORS_ALLOWED_ORIGINS` is restricted to the frontend origin(s) that embed the widget.
- [ ] `TRUST_PROXY=true` is set only behind a trusted reverse proxy.
- [ ] `TOKEN_SINGLE_USE=true` is kept unless your integration explicitly needs replayable tokens.
- [ ] SQLite data is stored on a persistent volume.
- [ ] Database backups are configured and restore-tested.
- [ ] `/health` is monitored.
- [ ] Logs are collected or rotated.
- [ ] Federation is disabled unless trusted peers are configured.
- [ ] `FEDERATION_ALLOW_PRIVATE_PEERS` is enabled only for private deployments.
- [ ] `PASSIVE_PROTECTION_BLOCK_DC=true` is tested before enforcing it in production.
