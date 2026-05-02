# API Reference

SavannaGuard exposes a public challenge/token API, an admin UI/API protected by
cookie authentication and CSRF headers, and optional peer-to-peer federation
endpoints authenticated with HMAC signatures.

## Authentication

### Public API

The challenge and token endpoints are unauthenticated. Put them behind your
normal site rate limits or reverse proxy controls when exposing them publicly.
They send CORS headers for browser integrations according to
`CORS_ALLOWED_ORIGINS`. The default is `*`; production deployments should
usually restrict this to the frontend origin(s) that embed the widget.

### Admin API

Admin routes use the `savanna_admin` HTTP-only cookie set by `POST /admin/login`.
Mutating admin requests also require double-submit CSRF protection:

- Cookie: `savanna_csrf`
- Header: `X-CSRF-Token: <savanna_csrf value>`
- Header: `X-Requested-With: SavannaAdmin`

### Federation API

Federation POST endpoints use HMAC-SHA256. Peers send:

- Header: `X-SavannaGuard-Hmac: <hex hmac>`
- Payload: the JSON request body
- Key: the peer-specific pre-shared key configured when the peer was added

The HMAC is computed over the JSON payload string.

## Public Endpoints

### `POST /api/v1/challenge/create`

Creates a Proof-of-Work challenge and a pending session.

Response `200`:

```json
{
  "challengeId": "uuid",
  "nonce": "hex-string",
  "difficulty": 4,
  "sessionId": "uuid",
  "obfKey": "hex-string"
}
```

Response `403`: passive protection blocked the request.

Response `429`: rate limit exceeded.

### `POST /api/v1/challenge/solve`

Submits the Proof-of-Work solution and optional telemetry. The widget normally
sends an obfuscated `d` payload, but direct JSON telemetry is also accepted.

Request:

```json
{
  "challengeId": "uuid",
  "solution": "hex-string",
  "sessionId": "uuid",
  "d": "optional-obfuscated-payload"
}
```

Common direct telemetry groups:

```json
{
  "mouseData": {},
  "keyboardData": {},
  "timingData": {},
  "canvasData": {},
  "webglData": {},
  "screenData": {},
  "navigatorData": {},
  "networkData": {},
  "timingOracleData": {},
  "tremorData": {},
  "webrtcOracleData": {}
}
```

Response `200`:

```json
{
  "success": true,
  "token": "signed-token-or-null",
  "score": 84,
  "verdict": "human",
  "federatedSource": false
}
```

Response `400`: invalid payload, challenge ID, solution, encoding, or session
mismatch.

Response `404`: challenge or session not found.

Response `410`: challenge expired.

Response `409`: challenge already solved.

### `POST /api/v1/token/validate`

Validates a token before your backend accepts the protected action.

Request:

```json
{
  "token": "signed-token"
}
```

Response `200`:

```json
{
  "valid": true,
  "verdict": "human",
  "score": 84
}
```

Invalid tokens return `valid: false`, `verdict: "bot"`, and `score: 0`.
By default, tokens are single-use: the first successful validation consumes the
token, and replay attempts return `valid: false`. Set `TOKEN_SINGLE_USE=false`
only if your backend intentionally validates the same token more than once.

### `GET /health`

Checks process and SQLite availability.

Response `200`:

```json
{ "ok": true }
```

Response `503`:

```json
{ "ok": false, "error": "Database unavailable" }
```

### `GET /widget/savanna-widget.iife.js`

Serves the browser widget bundle built from `packages/widget`.

## Admin UI

All admin UI pages require the admin cookie except `/admin/login`.

| Method | Path | Description |
|---|---|---|
| GET | `/admin/login` | Login form |
| POST | `/admin/login` | Sets admin and CSRF cookies, then redirects to `/admin` |
| GET | `/admin/logout` | Clears admin cookie |
| GET | `/admin` | Stats dashboard |
| GET | `/admin/threat` | Threat intelligence |
| GET | `/admin/flagged` | Flagged sessions |
| GET | `/admin/settings` | Settings |
| GET | `/admin/federation` | Federation peer management |

Failed admin login attempts lock the source IP for 15 minutes after 5 failures.

## Admin API

All endpoints require the admin cookie. Mutating endpoints also require CSRF
headers.

| Method | Path | Description |
|---|---|---|
| GET | `/admin/api/stats` | 24-hour dashboard counters |
| GET | `/admin/api/stats/timeseries` | 24-hour hourly verdict series |
| GET | `/admin/api/threat` | Adaptive threat status |
| GET | `/admin/api/learning` | Per-site learning status |
| GET | `/admin/api/signatures` | Local bot signature stats |
| GET | `/admin/api/flagged` | Latest bot/suspicious sessions |
| GET | `/admin/api/settings` | Current difficulty/adaptive/passive settings |
| POST | `/admin/api/settings` | Update difficulty/adaptive/passive settings |
| GET | `/admin/api/passive-protection` | Passive protection stats |
| GET | `/admin/api/federation/peers` | List peers without PSKs |
| POST | `/admin/api/federation/peers` | Add or update a peer |
| DELETE | `/admin/api/federation/peers/:peerId` | Remove a peer |
| POST | `/admin/api/federation/sync` | Sync one peer or all peers |
| GET | `/admin/api/federation/psk` | Return masked current federation PSK info |
| POST | `/admin/api/federation/rotate-psk` | Generate and persist a new federation PSK |
| GET | `/admin/api/federation/stats` | Federation counters and top signatures |

Settings update request:

```json
{
  "difficulty": 4,
  "adaptiveEnabled": true,
  "blockDatacenterIPs": false
}
```

Federation peer add request:

```json
{
  "peerUrl": "https://peer.example.com",
  "psk": "shared-peer-secret"
}
```

## Federation Endpoints

Federation is disabled unless `FEDERATION_ENABLED=true`.

| Method | Path | Authentication | Description |
|---|---|---|---|
| GET | `/federation/state` | None | Public lightweight state hash |
| POST | `/federation/state` | HMAC | Pull signatures from this peer |
| POST | `/federation/push` | HMAC | Compatibility alias for `/federation/state` |
| POST | `/federation/sync` | HMAC | Receive pushed signatures from a peer |

`POST /federation/sync` request:

```json
{
  "type": "signature_sync",
  "signatures": [
    {
      "hash": "sha256-hash",
      "hashType": "ip",
      "confidence": 0.9,
      "attackType": "unknown",
      "firstSeen": 1777745000000,
      "lastSeen": 1777745010000
    }
  ],
  "timestamp": 1777745010000
}
```

Response:

```json
{
  "received": 1,
  "merged": 1,
  "skipped": 0,
  "status": "ok"
}
```

### GET /admin/api/federation/psk
Get masked PSK (first 8...last 8 chars).

**Response 200:**
```json
{ "masked": "a1b2c3d4...x9y8z7w6" }
```

### POST /admin/api/federation/rotate-psk
Generate new PSK.

**Response 200:**
```json
{
  "ok": true,
  "psk": "full-64-char-hex-string"
}
```
WARNING: Save this immediately. Full PSK is only shown once.
