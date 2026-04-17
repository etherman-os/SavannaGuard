# SavannaGuard — Privacy-First Bot Security Layer

**Live Demo:** https://savannaguard.com

SavannaGuard is a true self-hosted, privacy-respecting security layer designed to do exactly what traditional CAPTCHAs miss. While other solutions focus only on frustrating image puzzles and tracking users across the web, SavannaGuard functions as an invisible, supplementary defense-in-depth tool.

By combining **Adaptive Proof-of-Work** that auto-adjusts to attack volume, **Per-Site ML Learning** (Online Gaussian model) that learns your real users' behavior, **Bot Signature Tracking** that flags recurring attackers, **JS Engine Timing Oracle** that detects headless browsers via V8 JIT patterns, and **Federated Bot Intelligence** that shares threat intelligence across instances — it creates a robust shield that can act as an alternative to—or an additional layer alongside—existing security measures.

**Zero third-party dependencies:** No Redis requirement, no external API calls to big tech, and absolutely no behavioral data leaving your servers.

## Key Features

### Adaptive Proof-of-Work
Automatically adjusts difficulty based on detected bot ratio. Under attack → harder puzzles. Quiet periods → minimal friction.

### Per-Site ML Learning
Online Gaussian model learns your legitimate users' behavior patterns after just 10+ human samples. Adapts to your traffic, not generic models.

### Bot Signature Tracking
Flags recurring attackers by IP+UA hash. Three matches = high confidence bot. Signature retention: 30 days.

### JS Engine Timing Oracle
Detects headless browsers (Puppeteer, Playwright, Selenium) via timing analysis of V8 JIT compilation patterns, crypto operations, and requestAnimationFrame behavior — **without UA sniffing**.

### Physiological Tremor Analysis
Human hands exhibit involuntary tremor at 8–12 Hz — a neurological constant present in all healthy users. SavannaGuard applies FFT to mouse velocity streams and measures power in this frequency band. Bots produce either flat noise or programmatic smoothness; neither matches biological entropy.

### WebRTC Topology Oracle
Before any form interaction, SavannaGuard passively collects WebRTC ICE candidates — the browser's own network self-report. Datacenter environments, single-interface VMs, and VPN leaks produce topology signatures that real home/office users never exhibit. Zero network requests required.

### Federated Bot Intelligence (P2P)
Self-hosted instances share bot signatures peer-to-peer via gossip protocol. When one instance detects a bot, all instances learn. No central server, no raw data leaves your network.

### 10 Behavioral Signal Collectors
Mouse dynamics, keystroke cadence, canvas fingerprint, WebGL rendering, screen metrics, navigator properties, network timing, page timing, physiological tremor, WebRTC topology — all processed locally with scores 0-100.

## Live Links

- **Website:** https://savannaguard.com
- **Repository:** https://github.com/etherman-os/SavannaGuard

## ⚡ 1-Minute Setup

### Docker (Recommended)

```bash
git clone https://github.com/etherman-os/SavannaGuard && cd SavannaGuard
cp .env.example .env
# Edit .env — at minimum, change SECRET_KEY and ADMIN_PASSWORD
nano .env
docker compose up -d
```

Open http://localhost:3000/admin and log in with your `ADMIN_PASSWORD`.

### One-Liner Setup

Generates a random `SECRET_KEY` and starts immediately:

```bash
git clone https://github.com/etherman-os/SavannaGuard && cd SavannaGuard && \
  cp .env.example .env && \
  sed -i "s/SECRET_KEY=change-me-to-a-random-string/SECRET_KEY=$(openssl rand -hex 32)/" .env && \
  sed -i "s/ADMIN_PASSWORD=admin/ADMIN_PASSWORD=change-me-before-deploying/" .env && \
  docker compose up -d
```

> ⚠️ Replace `change-me-before-deploying` with a strong password in the command above.

### Without Docker

```bash
git clone https://github.com/etherman-os/SavannaGuard && cd SavannaGuard
pnpm install
pnpm build
cp .env.example .env
# Edit .env — set SECRET_KEY and ADMIN_PASSWORD
pnpm --filter @savannaguard/server start
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SECRET_KEY` | ✅ Yes | — | Token encryption key. Generate with `openssl rand -hex 32`. |
| `ADMIN_PASSWORD` | No | `admin` | Admin dashboard login password. |
| `PORT` | No | `3000` | HTTP server port. |
| `DB_PATH` | No | `./data/savannaguard.db` | SQLite database path. Use `/data/` prefix in Docker. |
| `LOG_LEVEL` | No | `info` | Logging verbosity: `debug`, `info`, `warn`, `error`. |
| `FEDERATION_ENABLED` | No | `false` | Enable P2P federation for sharing bot signatures. |
| `FEDERATION_PEERS` | No | — | Comma-separated peer URLs (e.g. `https://sg1.example.com,https://sg2.example.com`). |
| `FEDERATION_PSK` | No | — | Pre-shared key for peer authentication. Required if federation is enabled. |
| `FEDERATION_SYNC_INTERVAL` | No | `300000` | Active peer sync interval in ms (5 min). |
| `FEDERATION_OFFLINE_SYNC_INTERVAL` | No | `1800000` | Offline peer recovery interval in ms (30 min). |
| `FEDERATION_OFFLINE_THRESHOLD` | No | `3` | Consecutive failures before marking peer offline. |
| `FEDERATION_MAX_PAYLOAD_BYTES` | No | `5242880` | Max sync payload size in bytes (5 MB). |
| `FEDERATION_REQUEST_TIMEOUT_MS` | No | `30000` | Peer request timeout in ms. |
| `FEDERATION_MAX_RETRIES` | No | `3` | Max retry attempts for failed peer requests. |
| `FEDERATION_BASE_RETRY_DELAY_MS` | No | `5000` | Base delay between retries in ms. |
| `FEDERATION_MAX_RETRY_DELAY_MS` | No | `60000` | Maximum delay between retries in ms. |

### Health Check

The server exposes a `/health` endpoint that returns `{"ok": true}`. Docker Compose uses this for automatic container health checks.

### Federation Setup

To enable P2P bot intelligence sharing between SavannaGuard instances:

1. Set `FEDERATION_ENABLED=true` on both instances
2. Set the same `FEDERATION_PSK` on both instances
3. Add each instance's URL to the other's `FEDERATION_PEERS`
4. Restart both instances

See [FEDERATION.md](FEDERATION.md) for the full protocol specification.

## Usage Summary

SavannaGuard usage flow in production:

1. Frontend requests a challenge from `/api/v1/challenge/create`.
2. Widget solves PoW and sends telemetry to `/api/v1/challenge/solve`.
3. Backend validates the issued token with `/api/v1/token/validate` before processing user action.

## Run Tests

```bash
pnpm test
```

To run only server tests:

```bash
pnpm --filter @savannaguard/server test
```

## Form Integration

```html
<!-- Add the widget script -->
<script src="http://localhost:3000/widget/savanna-widget.iife.js" async></script>

<!-- Hidden token field in your form -->
<form id="my-form">
  <input type="hidden" name="savanna_token" id="savanna_token">
  <input type="email" name="email" placeholder="Email">
  <button type="submit">Submit</button>
</form>

<script>
// Optional if you want to override API URL manually.
// Widget auto-detects API origin from script src by default.
window.SavannaGuard.init('http://localhost:3000');

document.getElementById('my-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = await window.SavannaGuard.getToken();
  if (token) {
    document.getElementById('savanna_token').value = token;
  }
  e.target.submit();
});
</script>
```

## Architecture

- **Server**: Fastify + SQLite — handles PoW challenges, token generation, session scoring
- **Widget**: Vanilla TS via Vite — Web Worker PoW solver, behavioral collectors (6.6kb gzip)
- **Admin**: Alpine.js UI served by server — stats, flagged sessions, settings

## The Science Behind Detection

SavannaGuard's detection methods are grounded in observable biological and network phenomena that bots cannot easily replicate.

### Physiological Tremor Analysis (Signal #9)
Human hands exhibit involuntary tremor at 8–12 Hz — a neurological constant present in all healthy users. SavannaGuard applies FFT to mouse velocity streams and measures power in this frequency band. Bots produce either flat noise or programmatic smoothness; neither matches biological entropy.

### WebRTC Topology Oracle
Before any form interaction, SavannaGuard passively collects WebRTC ICE candidates — the browser's own network self-report. Datacenter environments, single-interface VMs, and VPN leaks produce topology signatures that real home/office users never exhibit. Zero network requests required.

### Try to Beat It
We invite security researchers to attempt bypass. Open an issue with your approach — successful bypasses that get patched earn credit in this README.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/challenge/create | Create PoW challenge |
| POST | /api/v1/challenge/solve | Submit PoW solution + behavioral data |
| POST | /api/v1/token/validate | Validate a token |
| GET | /admin | Admin stats page |
| GET | /admin/threat | Threat intelligence tab |
| GET | /admin/flagged | Flagged sessions page |
| GET | /admin/settings | Settings page |
| GET | /admin/federation | Federation management |

## Comparison

| Feature | SavannaGuard | Cloudflare Turnstile | hCaptcha |
|---------|:------------:|:--------------------:|:--------:|
| Self-hosted | ✅ | ❌ | ❌ |
| No external API calls | ✅ | ❌ | ❌ |
| ML learning per-site | ✅ | ❌ | ✅ |
| Headless browser detection | ✅ | Limited | ❌ |
| Physiological tremor analysis | ✅ | ❌ | ❌ |
| WebRTC topology oracle | ✅ | ❌ | ❌ |
| Federated threat intelligence | ✅ | ❌ | ❌ |
| Adaptive PoW difficulty | ✅ | ❌ | ❌ |
| Behavioral signal collectors | 10 signals | Unknown | Minimal |
| SQLite (no Redis) | ✅ | N/A | N/A |

## Tech Stack

Fastify · SQLite · TypeScript · Vite · Alpine.js · Docker Compose

## Licensing

- This repository is source-available (not OSI open source).
- Community self-hosting is allowed.
- Hosted/managed resale requires a separate commercial agreement.
- See LICENSE and COMMERCIAL_USE.md for details.

## Open-Core Boundary

- This repo: Community verification core (self-hostable).
- Paid/Private repo: billing, tenant provisioning, managed control-plane, enterprise features.

## Privacy

- No Redis — challenge/session state uses SQLite only
- No behavioral raw data — only aggregate scores (0–100) stored
- IP addresses hashed (SHA256 + rotating daily salt), never stored in plain text

## Token Validation Example

```ts
import fetch from 'node-fetch';

async function verifySavannaToken(token: string) {
  const response = await fetch('http://localhost:3000/api/v1/token/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  const data = await response.json();
  // { valid: true, verdict: 'human', score: 84 }
  return data;
}
```
