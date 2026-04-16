# SavannaGuard — Privacy-First Bot Security Layer

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

- Website: https://savannaguard.com
- Repository: https://github.com/etherman-os/SavannaGuard

## Quick Start (3 commands)

```bash
git clone https://github.com/etherman-os/SavannaGuard && cd SavannaGuard
cp .env.example .env
docker compose up -d
```

Then open http://localhost:3000/admin (default password: `admin`).

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
- **Widget**: Vanilla TS via Vite — Web Worker PoW solver, behavioral collectors (5.8kb gzip)
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
