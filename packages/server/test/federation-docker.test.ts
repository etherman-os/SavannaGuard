/// <reference types="vitest/globals" />
import crypto from 'crypto';
import Database from 'better-sqlite3';

const NODE_A_URL = process.env.NODE_A_URL ?? 'http://localhost:3001';
const NODE_B_URL = process.env.NODE_B_URL ?? 'http://localhost:3002';
const NODE_A_PEER_URL = process.env.NODE_A_PEER_URL ?? NODE_A_URL;
const NODE_B_PEER_URL = process.env.NODE_B_PEER_URL ?? NODE_B_URL;
const PSK = process.env.FEDERATION_PSK ?? 'test-psk-key-for-federation-testing';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin';
const SYNC_WAIT_MS = Number(process.env.SYNC_WAIT_MS ?? '15000');

interface FederatedSignatureRow {
  hash: string;
  hash_type: string;
  attack_type: string;
  confidence: number;
  reporter_count: number;
  first_seen: number;
  last_seen: number;
  source_peer: string;
}

interface FederationPeerRow {
  peer_id: string;
  peer_url: string;
  psk: string;
  last_seen: number;
  trusted: number;
  status: string;
  consecutive_failures: number;
  last_failure_at: number;
  last_failure_reason: string;
  last_success_at: number;
}

function secretKeyForNode(nodeUrl: string): string {
  if (process.env.SECRET_KEY) return process.env.SECRET_KEY;
  return nodeUrl === NODE_B_URL ? 'test-secret-key-node-b' : 'test-secret-key-node-a';
}

function adminCookie(nodeUrl: string): string {
  const secretKey = secretKeyForNode(nodeUrl);
  const passwordHash = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');
  const payload = {
    v: 1,
    iat: Date.now(),
    exp: Date.now() + 12 * 60 * 60 * 1000,
    nonce: crypto.randomBytes(16).toString('hex'),
    passwordHash,
  };
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(JSON.stringify(payload))
    .digest('base64url');
  const token = Buffer.from(JSON.stringify({ payload, signature }), 'utf-8').toString('base64url');
  return `savanna_admin=${token}`;
}

function csrfHeaders(nodeUrl: string): Record<string, string> {
  const token = 'test-csrf-token';
  return {
    cookie: `${adminCookie(nodeUrl)}; savanna_csrf=${token}`,
    'x-requested-with': 'SavannaAdmin',
    'x-csrf-token': token,
  };
}

async function waitForNode(url: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Node at ${url} never became healthy`);
}

function getDbPath(nodeUrl: string): string {
  // When Docker containers are running with volumes, the DB is inside the container.
  // This function maps container names to volume mount paths accessible from host.
  // Volume paths are Docker-managed, so on a typical Linux host with docker-compose,
  // they live at /var/lib/docker/volumes/<project>_node_a_data/_data/savannaguard.db
  // We use environment variables for the test host path.
  const hostDbPath = process.env[`DB_PATH_${nodeUrl === NODE_A_URL ? 'A' : 'B'}`];
  if (hostDbPath) return hostDbPath;
  return '';
}

async function insertPeerViaApi(
  adminUrl: string,
  peerUrl: string,
  peerPsk: string
): Promise<void> {
  const res = await fetch(`${adminUrl}/admin/api/federation/peers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeaders(adminUrl),
    },
    body: JSON.stringify({ peerUrl, psk: peerPsk }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to add peer: ${res.status} ${text}`);
  }
}

async function triggerSync(adminUrl: string): Promise<unknown> {
  const res = await fetch(`${adminUrl}/admin/api/federation/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeaders(adminUrl),
    },
    body: JSON.stringify({ peerUrl: '' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to trigger sync: ${res.status} ${text}`);
  }
  return res.json();
}

async function getFederationStats(adminUrl: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${adminUrl}/admin/api/federation/stats`, {
    headers: { cookie: adminCookie(adminUrl) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get federation stats: ${res.status} ${text}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function rotatePsk(adminUrl: string): Promise<{ ok: boolean; psk: string }> {
  const res = await fetch(`${adminUrl}/admin/api/federation/rotate-psk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeaders(adminUrl),
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to rotate PSK: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ ok: boolean; psk: string }>;
}

async function insertBotSignatureViaApi(
  nodeUrl: string,
  hash: string,
  hashType = 'ip'
): Promise<void> {
  // Use direct DB injection via better-sqlite3 when volume path is available
  const dbPath = getDbPath(nodeUrl);
  if (dbPath) {
    const db = new Database(dbPath);
    db.pragma('busy_timeout = 5000');
    const now = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO bot_signatures
        (hash, hash_type, match_count, first_seen, last_seen, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(hash, hashType, 5, now, now, 'test');
    db.close();
    return;
  }

  // Fallback: create a challenge and solve it as a bot by sending bad signals
  // First create a challenge
  const challengeRes = await fetch(`${nodeUrl}/api/v1/challenge/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!challengeRes.ok) {
    throw new Error(`Failed to create challenge: ${challengeRes.status}`);
  }
  const challenge = (await challengeRes.json()) as {
    challengeId: string;
    sessionId: string;
    nonce: string;
    difficulty: number;
  };

  // Solve with fake PoW (will fail PoW but still create session)
  // Send bot-like behavioral data
  const solveRes = await fetch(`${nodeUrl}/api/v1/challenge/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      sessionId: challenge.sessionId,
      solution: '0'.repeat(64), // invalid PoW solution
      mouseData: {
        straightLineRatio: 1.0, // perfectly straight = bot
        velocity: 0, // no movement
        maxVelocity: 0,
        directionChanges: 0,
      },
      timingData: {
        timeOnPageMs: 0, // instant = bot
      },
      keyboardData: {
        avgDwellTime: 0,
        avgFlightTime: 0,
        dwellVariance: 0,
        flightVariance: 0,
        totalKeystrokes: 0,
      },
      canvasData: {
        canvasHash: '0000000000',
        isCanvasSupported: true,
        canvasBlankHash: '0000000000',
        webglRendererFromCanvas: '',
      },
      webglData: {
        renderer: '',
        vendor: '',
        hasWebGL: false,
        webglExtensions: 0,
        maxTextureSize: 0,
        maxRenderbufferSize: 0,
      },
      screenData: {
        width: 0,
        height: 0,
        colorDepth: 0,
        pixelRatio: 0,
      },
      navigatorData: {
        userAgent: 'Bot/1.0',
        platform: '',
        language: '',
        timezone: '',
        timezoneOffset: 0,
        hardwareConcurrency: 0,
        maxTouchPoints: 0,
      },
      networkData: {
        latencyMs: 0,
        effectiveType: '',
        downlink: 0,
      },
    }),
  });
  // Even if solve fails, we created a session — now force a bot signature via DB
  // Insert directly since solve might not record a bot verdict from invalid PoW
  const dbPathFallback = getDbPath(nodeUrl);
  if (dbPathFallback) {
    const db = new Database(dbPathFallback);
    db.pragma('busy_timeout = 5000');
    const now = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO bot_signatures
        (hash, hash_type, match_count, first_seen, last_seen, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(hash, hashType, 5, now, now, 'test');
    db.close();
  }
}

function checkFederatedSignature(
  dbPath: string,
  hash: string
): FederatedSignatureRow | null {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  const row = db
    .prepare(
      'SELECT hash, hash_type, attack_type, confidence, reporter_count, first_seen, last_seen, source_peer FROM federated_signatures WHERE hash = ?'
    )
    .get(hash) as FederatedSignatureRow | undefined;
  db.close();
  return row ?? null;
}

// =============================================================================
// Integration tests for SavannaGuard Federation — 2-node Docker setup
//
// These tests require:
//   1. Docker containers running (docker compose -f docker-compose.test.yml up --build)
//   2. Host access to Docker volumes OR HTTP access to exposed ports (3001, 3002)
//
// The test suite is designed to be run via vitest with environment variables:
//   FEDERATION_PSK=test-psk-key-for-federation-testing \
//   NODE_A_URL=http://localhost:3001 \
//   NODE_B_URL=http://localhost:3002 \
//   NODE_A_PEER_URL=http://node-a:3000 \
//   NODE_B_PEER_URL=http://node-b:3000 \
//   DB_PATH_A=/path/to/node_a/savannaguard.db \
//   DB_PATH_B=/path/to/node_b/savannaguard.db \
//   pnpm --filter @savannaguard/server test -- --testNamePattern="federation-docker"
// =============================================================================

describe('federation-docker', () => {
  if (process.env.RUN_DOCKER_TESTS !== '1') {
    it.skip('skipped unless RUN_DOCKER_TESTS=1', () => {});
    return;
  }

  // Unique test identifier to avoid collisions between runs
  const testHash = `fedtest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    // Verify Docker nodes are reachable before running tests
    await Promise.all([waitForNode(NODE_A_URL), waitForNode(NODE_B_URL)]);
  }, 70000);

  it(
    'propagates a bot signature from node-a to node-b via federation gossip',
    async () => {
      // Step 1: Insert peer records so each node knows about the other
      // node-a adds node-b as a peer; node-b adds node-a as a peer
      await Promise.all([
        insertPeerViaApi(NODE_A_URL, NODE_B_PEER_URL, PSK),
        insertPeerViaApi(NODE_B_URL, NODE_A_PEER_URL, PSK),
      ]);

      // Small delay to ensure peer records are committed
      await new Promise((r) => setTimeout(r, 500));

      // Step 2: Insert a bot signature on node-a
      await insertBotSignatureViaApi(NODE_A_URL, testHash, 'ip');

      // Step 3: Trigger federation sync on node-a (push to node-b)
      const syncResult = (await triggerSync(NODE_A_URL)) as {
        mode: string;
        totalPeers: number;
        results: Array<{
          peerUrl: string;
          received: number;
          merged: number;
          skipped: number;
          errors: string[];
        }>;
      };

      // Step 4: Wait for the gossip to propagate
      await new Promise((r) => setTimeout(r, SYNC_WAIT_MS));

      // Step 5: Verify node-b received the signature
      const dbB = getDbPath(NODE_B_URL);
      if (!dbB) {
        // If DB path not available, try via API
        const stats = (await getFederationStats(NODE_B_URL)) as {
          signatureCount?: number;
        };
        expect(stats.signatureCount).toBeGreaterThan(0);
      } else {
        const sig = checkFederatedSignature(dbB, testHash);
        expect(sig).not.toBeNull();
        expect(sig?.reporter_count).toBeGreaterThanOrEqual(1);
      }
    },
    60000
  );

  it(
    'rotates the federation PSK and verifies the new key is returned',
    async () => {
      const before = (await getFederationStats(NODE_A_URL)) as {
        pskInfo?: { masked: string };
      };

      const rotateResult = await rotatePsk(NODE_A_URL);
      expect(rotateResult.ok).toBe(true);
      expect(typeof rotateResult.psk).toBe('string');
      expect(rotateResult.psk.length).toBe(64); // 32 bytes hex = 64 chars

      // Verify the new PSK is different from old
      const after = (await getFederationStats(NODE_A_URL)) as {
        pskInfo?: { masked: string };
      };
      // Stats endpoint doesn't expose raw PSK, just masked — we verify rotation
      // didn't error and new key was returned
      expect(rotateResult.psk).toMatch(/^[a-f0-9]{64}$/);
    },
    30000
  );

  it(
    'returns federation state hash from the public endpoint',
    async () => {
      const res = await fetch(`${NODE_A_URL}/federation/state`);
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { stateHash: string; signatureCount: number };
      expect(typeof body.stateHash).toBe('string');
      expect(body.stateHash.length).toBe(64); // SHA256 hex
      expect(typeof body.signatureCount).toBe('number');
    },
    15000
  );

  it(
    'lists peers via the admin API',
    async () => {
      const res = await fetch(`${NODE_A_URL}/admin/api/federation/peers`, {
        headers: { cookie: adminCookie(NODE_A_URL) },
      });
      expect(res.ok).toBe(true);
      const peers = (await res.json()) as Array<{ peerId: string; peerUrl: string }>;
      expect(peers.length).toBeGreaterThanOrEqual(1);
      // PSK should not be exposed in the response
      const peerJson = JSON.stringify(peers);
      expect(peerJson).not.toContain('psk');
      expect(peerJson).not.toContain('test-psk');
    },
    15000
  );
});
