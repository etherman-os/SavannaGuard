# SavannaGuard — Privacy-First Bot Protection

Self-hosted, privacy-respecting bot verification using Proof-of-Work and behavioral scoring. No Redis, no external services, no behavioral data leaving your server.

## Live Links

- Website: https://savannaguard.com
- Repository: https://github.com/etherman-os/SavannaGuard

## Quick Start (3 commands)

```bash
git clone https://github.com/yourname/savannaguard && cd savannaguard
cp .env.example .env
docker compose up -d
```

Then open http://localhost:3000/admin (default password: `admin`).

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
- **Widget**: Vanilla TS via Vite — Web Worker PoW solver, behavioral collectors (<5kb gzip)
- **Admin**: Alpine.js UI served by server — stats, flagged sessions, settings

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/challenge/create | Create PoW challenge |
| POST | /api/v1/challenge/solve | Submit PoW solution + behavioral data |
| POST | /api/v1/token/validate | Validate a token |
| GET | /admin | Admin stats page |
| GET | /admin/flagged | Flagged sessions page |
| GET | /admin/settings | Settings page |

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

## Preview Landing Page (GitHub Pages)

A pre-launch landing page is included in `preview/` so you can publish a teaser site as soon as the repository is public.

What it includes:

- Product preview copy focused on frictionless anti-bot positioning
- Waitlist form with three modes:
  - Custom endpoint (`waitlistEndpoint`)
  - Email delivery via FormSubmit (`waitlistEmail`)
  - Local fallback storage if no destination is configured

Setup:

1. Edit `preview/config.js` and set:
   - `githubRepoUrl` to your public repository URL
   - `waitlistEndpoint` (optional) to your API endpoint
   - or `waitlistEmail` to route signups to your inbox using FormSubmit
2. Push to `main` (or `master`).
3. In GitHub repository settings, enable Pages with source set to **GitHub Actions**.

The workflow file is `.github/workflows/preview-pages.yml` and deploys the `preview/` folder.

### Custom Domain (Cloudflare)

If you own `savannaguard.com` in Cloudflare, use this setup:

1. Keep `preview/CNAME` as `savannaguard.com`.
2. In GitHub repo settings -> Pages, set **Custom domain** to `savannaguard.com` and enable **Enforce HTTPS**.
3. In Cloudflare DNS, remove any `A` records where **Name** is `www`.
4. Add apex records with **Name** set to `@`:
  - `A` -> `185.199.108.153`
  - `A` -> `185.199.109.153`
  - `A` -> `185.199.110.153`
  - `A` -> `185.199.111.153`
5. Add `www` alias with **Name** `www`:
  - `CNAME` -> `savannaguard.com`
6. Set Proxy status to **DNS only** while first setup/SSL provisioning is completing. After HTTPS is active, you can switch proxy back to orange cloud if needed.

Note: DNS propagation can take a few minutes.

## Business Docs

- docs/GO_TO_MARKET.md
- docs/LANDING_PAGE_COPY.md
- docs/landing-page.html
- docs/PAID_SERVER_BLUEPRINT.md

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
