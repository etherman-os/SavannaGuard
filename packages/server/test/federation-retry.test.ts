/// <reference types="vitest/globals" />
import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { db } from '../src/db.js';
import { logger } from '../src/services/logger.js';
import { createAdminSessionCookie } from '../src/services/adminAuth.js';
import {
  FederationError,
  NetworkError,
  TimeoutError,
  AuthError,
  ServerError,
  RateLimitError,
  ParseError,
  PayloadTooLargeError,
  classifyFetchError,
  classifyHttpResponse,
} from '../src/services/federation-errors.js';
import { retryWithBackoff } from '../src/services/retry.js';

const CSRF_TOKEN = 'test-csrf-token-for-federation-retry';

function adminCookieHeader(): string {
  return `savanna_admin=${createAdminSessionCookie()}; savanna_csrf=${CSRF_TOKEN}`;
}

/** Headers required for admin POST endpoints protected by requireAdminCsrf */
function adminCsrfHeaders(): Record<string, string> {
  return {
    cookie: adminCookieHeader(),
    'x-requested-with': 'SavannaAdmin',
    'x-csrf-token': CSRF_TOKEN,
  };
}

function makeHmac(payload: object, psk: string): string {
  return crypto.createHmac('sha256', psk).update(JSON.stringify(payload)).digest('hex');
}

async function addPeerViaAdmin(app: FastifyInstance, peerUrl: string, psk: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/api/federation/peers',
    headers: adminCsrfHeaders(),
    payload: { peerUrl, psk },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { peer: { peerId: string; peerUrl: string; consecutiveFailures: number } };
}

describe('federation error classification', () => {
  it('classifies connection refused as NetworkError', () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:3000');
    const classified = classifyFetchError(error, 'http://peer1:3000');
    expect(classified).toBeInstanceOf(NetworkError);
    expect(classified.retryable).toBe(true);
  });

  it('classifies DNS errors as NetworkError', () => {
    const error = new Error('getaddrinfo ENOTFOUND peer1.local');
    const classified = classifyFetchError(error, 'http://peer1.local:3000');
    expect(classified).toBeInstanceOf(NetworkError);
  });

  it('classifies connection reset as NetworkError', () => {
    const error = new Error('read ECONNRESET');
    const classified = classifyFetchError(error, 'http://peer1:3000');
    expect(classified).toBeInstanceOf(NetworkError);
  });

  it('classifies already-classified FederationError as-is', () => {
    const original = new TimeoutError('http://peer1:3000');
    const classified = classifyFetchError(original, 'http://peer1:3000');
    expect(classified).toBe(original);
  });

  it('classifies AbortError as TimeoutError', () => {
    const error = new DOMException('The operation was aborted', 'AbortError');
    const classified = classifyFetchError(error, 'http://peer1:3000');
    expect(classified).toBeInstanceOf(TimeoutError);
    expect(classified.retryable).toBe(true);
  });

  it('classifies fetch TypeError as NetworkError', () => {
    const error = new TypeError('fetch failed');
    const classified = classifyFetchError(error, 'http://peer1:3000');
    expect(classified).toBeInstanceOf(NetworkError);
  });

  it('classifies unknown errors as NetworkError', () => {
    const classified = classifyFetchError('string error', 'http://peer1:3000');
    expect(classified).toBeInstanceOf(NetworkError);
  });
});

describe('federation HTTP response classification', () => {
  it('classifies 401 as AuthError (not retryable)', () => {
    const error = classifyHttpResponse(401, 'http://peer1:3000');
    expect(error).toBeInstanceOf(AuthError);
    expect(error?.retryable).toBe(false);
  });

  it('classifies 403 as AuthError', () => {
    const error = classifyHttpResponse(403, 'http://peer1:3000');
    expect(error).toBeInstanceOf(AuthError);
  });

  it('classifies 429 as RateLimitError', () => {
    const error = classifyHttpResponse(429, 'http://peer1:3000');
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error?.retryable).toBe(true);
    expect((error as RateLimitError).retryAfterMs).toBe(60_000);
  });

  it('classifies 500 as ServerError', () => {
    const error = classifyHttpResponse(500, 'http://peer1:3000');
    expect(error).toBeInstanceOf(ServerError);
    expect(error?.retryable).toBe(true);
  });

  it('classifies 502/503 as ServerError', () => {
    expect(classifyHttpResponse(502, 'http://peer1:3000')).toBeInstanceOf(ServerError);
    expect(classifyHttpResponse(503, 'http://peer1:3000')).toBeInstanceOf(ServerError);
  });

  it('returns null for 200/404/413', () => {
    expect(classifyHttpResponse(200, 'http://peer1:3000')).toBeNull();
    expect(classifyHttpResponse(204, 'http://peer1:3000')).toBeNull();
    expect(classifyHttpResponse(404, 'http://peer1:3000')).toBeNull();
    expect(classifyHttpResponse(413, 'http://peer1:3000')).toBeNull();
  });
});

describe('retryWithBackoff', () => {
  it('returns result on first success', async () => {
    const result = await retryWithBackoff(
      async () => 'ok',
      { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, context: 'test' },
    );
    expect(result).toBe('ok');
  });

  it('retries on retryable FederationError and eventually succeeds', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        attempts++;
        if (attempts < 3) throw new NetworkError('http://peer1:3000');
        return 'recovered';
      },
      { maxRetries: 3, baseDelayMs: 5, maxDelayMs: 20, context: 'test' },
    );
    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
  }, 10000);

  it('does not retry on non-retryable error (AuthError)', async () => {
    let attempts = 0;
    try {
      await retryWithBackoff(
        async () => {
          attempts++;
          throw new AuthError('http://peer1:3000', 401);
        },
        { maxRetries: 3, baseDelayMs: 5, maxDelayMs: 20, context: 'test' },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
    }
    expect(attempts).toBe(1);
  });

  it('throws after exhausting all retries', async () => {
    try {
      await retryWithBackoff(
        async () => {
          throw new ServerError('http://peer1:3000', 500);
        },
        { maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20, context: 'test' },
      );
      fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ServerError);
    }
  }, 10000);

  it('rethrows non-FederationError immediately', async () => {
    const unexpectedError = new Error('something unexpected');
    try {
      await retryWithBackoff(
        async () => { throw unexpectedError; },
        { maxRetries: 3, baseDelayMs: 5, maxDelayMs: 20, context: 'test' },
      );
    } catch (error) {
      expect(error).toBe(unexpectedError);
    }
  });

  it('works with maxRetries=0 (single attempt, no retry)', async () => {
    let attempts = 0;
    try {
      await retryWithBackoff(
        async () => {
          attempts++;
          throw new TimeoutError('http://peer1:3000');
        },
        { maxRetries: 0, baseDelayMs: 5, maxDelayMs: 20, context: 'test' },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
    }
    expect(attempts).toBe(1);
  });
});

describe('federation peer failure tracking', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    logger.setLevel('error');
  });

  beforeEach(async () => {
    app = buildServer();
    await app.ready();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
    db.exec('DELETE FROM federation_sync_state;');
    db.exec('DELETE FROM federated_signature_reports;');
    db.exec('DELETE FROM federated_signatures;');
    db.exec('DELETE FROM federation_peers;');
  });

  it('marks peer with consecutive failures after sync failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));

    await addPeerViaAdmin(app, 'https://peer-test-fail.example.com:19999', 'fail-psk');

    const syncResponse = await app.inject({
      method: 'POST',
      url: '/admin/api/federation/sync',
      headers: adminCsrfHeaders(),
      payload: { peerUrl: '' },
    });

    expect(syncResponse.statusCode).toBe(200);
    const result = syncResponse.json() as Record<string, unknown>;
    expect(result.failedPeers).toBeGreaterThan(0);

    const peersResponse = await app.inject({
      method: 'GET',
      url: '/admin/api/federation/peers',
      headers: { cookie: adminCookieHeader() },
    });
    const peers = peersResponse.json() as Array<Record<string, unknown>>;
    expect(peers[0].consecutiveFailures).toBeGreaterThan(0);
    expect(peers[0].lastFailureReason).toContain('Network error');

    vi.unstubAllGlobals();
  });

  it('recovers peer to active after successful sync', async () => {
    let shouldFail = true;
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (shouldFail) {
        throw new Error('ECONNREFUSED');
      }
      if (url.endsWith('/federation/state')) {
        return new Response(JSON.stringify({
          signatures: [],
          stateHash: 'recovery-hash',
          syncVersion: 1,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/federation/sync')) {
        return new Response(JSON.stringify({ received: 0, merged: 0, skipped: 0, status: 'ok' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ received: 0, status: 'ok' }), { status: 200 });
    }));

    await addPeerViaAdmin(app, 'https://peer-test-recovery.example.com:19998', 'recovery-psk');

    // First sync fails
    await app.inject({
      method: 'POST',
      url: '/admin/api/federation/sync',
      headers: adminCsrfHeaders(),
      payload: { peerUrl: '' },
    });

    // After failure, peer should have failures
    let peersResponse = await app.inject({
      method: 'GET',
      url: '/admin/api/federation/peers',
      headers: { cookie: adminCookieHeader() },
    });
    let peers = peersResponse.json() as Array<Record<string, unknown>>;
    expect(peers[0].consecutiveFailures).toBeGreaterThan(0);

    // Now make the peer succeed
    shouldFail = false;

    await app.inject({
      method: 'POST',
      url: '/admin/api/federation/sync',
      headers: adminCsrfHeaders(),
      payload: { peerUrl: '' },
    });

    // Peer should be back to active with 0 failures
    peersResponse = await app.inject({
      method: 'GET',
      url: '/admin/api/federation/peers',
      headers: { cookie: adminCookieHeader() },
    });
    peers = peersResponse.json() as Array<Record<string, unknown>>;
    expect(peers[0].consecutiveFailures).toBe(0);
    expect(peers[0].status).toBe('active');

    vi.unstubAllGlobals();
  });

  it('does not increment failures when pull succeeds but push fails', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/federation/state')) {
        return new Response(JSON.stringify({
          signatures: [],
          stateHash: 'pull-ok',
          syncVersion: 1,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/federation/sync')) {
        callCount++;
        throw new Error('ECONNREFUSED on push');
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));

    await addPeerViaAdmin(app, 'https://peer-test-pushfail.example.com:19996', 'pushfail-psk');

    const now = Date.now();
    db.prepare(
      `INSERT INTO bot_signatures (hash, hash_type, match_count, first_seen, last_seen, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('push-fail-hash', 'ip', 3, now - 1000, now, 'test');

    const syncResponse = await app.inject({
      method: 'POST',
      url: '/admin/api/federation/sync',
      headers: adminCsrfHeaders(),
      payload: { peerUrl: '' },
    });

    expect(syncResponse.statusCode).toBe(200);
    const syncBody = syncResponse.json() as { results?: Array<{ errors: string[] }> };
    expect(syncBody.results?.[0]?.errors.some((e) => e.includes('Push failed'))).toBe(true);

    const peersResponse = await app.inject({
      method: 'GET',
      url: '/admin/api/federation/peers',
      headers: { cookie: adminCookieHeader() },
    });
    const peers = peersResponse.json() as Array<Record<string, unknown>>;
    expect(peers[0].consecutiveFailures).toBe(0);
    expect(peers[0].status).toBe('active');
    expect(callCount).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });
});

describe('payload size protection', () => {
  it('creates PayloadTooLargeError with correct properties', () => {
    const error = new PayloadTooLargeError('http://peer1:3000', 10_000_000, 5_242_880);
    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect(error.retryable).toBe(false);
    expect(error.contentLength).toBe(10_000_000);
    expect(error.maxBytes).toBe(5_242_880);
    expect(error.peerUrl).toBe('http://peer1:3000');
  });
});

describe('federation pull payload hardening', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    app = buildServer();
    await app.ready();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
    db.exec('DELETE FROM federation_sync_state;');
    db.exec('DELETE FROM federated_signature_reports;');
    db.exec('DELETE FROM federated_signatures;');
    db.exec('DELETE FROM federation_peers;');
  });

  it('normalizes malformed pulled signatures instead of crashing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/federation/state')) {
        return new Response(JSON.stringify({
          signatures: [
            null,
            123,
            { hashType: 'ip', confidence: 0.9 },
            { hash: 'valid-hash', hashType: 'invalid-type', attackType: 'x'.repeat(80), confidence: 7 },
          ],
          stateHash: 42,
          syncVersion: '5.8',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/federation/sync')) {
        return new Response(JSON.stringify({ received: 0, merged: 0, skipped: 0, status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));

    await addPeerViaAdmin(app, 'https://peer-test-pullsanitize.example.com:19995', 'pullsanitize-psk');

    const syncResponse = await app.inject({
      method: 'POST',
      url: '/admin/api/federation/sync',
      headers: adminCsrfHeaders(),
      payload: { peerUrl: '' },
    });

    expect(syncResponse.statusCode).toBe(200);
    const syncBody = syncResponse.json() as { results: Array<{ merged: number; skipped: number }> };
    expect(syncBody.results[0].merged).toBeGreaterThanOrEqual(1);
    expect(syncBody.results[0].skipped).toBeGreaterThanOrEqual(3);

    const signature = db.prepare(
      'SELECT hash, hash_type, attack_type, confidence, reporter_count FROM federated_signatures WHERE hash = ?'
    ).get('valid-hash') as {
      hash: string;
      hash_type: string;
      attack_type: string;
      confidence: number;
      reporter_count: number;
    } | undefined;

    expect(signature).toBeDefined();
    expect(signature?.hash_type).toBe('ip');
    expect(signature?.attack_type.length).toBeLessThanOrEqual(50);
    expect(signature?.confidence).toBe(1);
    expect(signature?.reporter_count).toBe(1);

    const syncState = db.prepare(
      'SELECT sync_version FROM federation_sync_state LIMIT 1'
    ).get() as { sync_version: number } | undefined;
    expect(syncState?.sync_version).toBe(5);
  });
});

describe('federation error hierarchy', () => {
  it('all errors extend FederationError', () => {
    expect(new NetworkError('http://p:1')).toBeInstanceOf(FederationError);
    expect(new TimeoutError('http://p:1')).toBeInstanceOf(FederationError);
    expect(new AuthError('http://p:1', 401)).toBeInstanceOf(FederationError);
    expect(new ServerError('http://p:1', 500)).toBeInstanceOf(FederationError);
    expect(new RateLimitError('http://p:1', 60000)).toBeInstanceOf(FederationError);
    expect(new ParseError('http://p:1')).toBeInstanceOf(FederationError);
    expect(new PayloadTooLargeError('http://p:1', 100, 50)).toBeInstanceOf(FederationError);
  });

  it('retryable errors are correctly flagged', () => {
    expect(new NetworkError('http://p:1').retryable).toBe(true);
    expect(new TimeoutError('http://p:1').retryable).toBe(true);
    expect(new ServerError('http://p:1', 500).retryable).toBe(true);
    expect(new RateLimitError('http://p:1', 60000).retryable).toBe(true);
    expect(new AuthError('http://p:1', 401).retryable).toBe(false);
    expect(new ParseError('http://p:1').retryable).toBe(false);
    expect(new PayloadTooLargeError('http://p:1', 100, 50).retryable).toBe(false);
  });

  it('errors include statusCode where applicable', () => {
    expect((new AuthError('http://p:1', 401) as AuthError).statusCode).toBe(401);
    expect((new ServerError('http://p:1', 502) as ServerError).statusCode).toBe(502);
    expect((new RateLimitError('http://p:1', 60000) as RateLimitError).statusCode).toBe(429);
    expect(new NetworkError('http://p:1').statusCode).toBeUndefined();
    expect(new TimeoutError('http://p:1').statusCode).toBeUndefined();
  });
});

describe('CRDT merge skip logic', () => {
  it('skips merge when same peer sends identical data', async () => {
    const app = buildServer();
    await app.ready();

    try {
      await addPeerViaAdmin(app, 'https://peer-test-merge1.example.com:19100', 'merge-psk');

      const body = {
        type: 'push',
        signatures: [{
          hash: 'merge-hash-1',
          hashType: 'ip',
          confidence: 0.9,
          attackType: 'scraping',
          firstSeen: Date.now() - 1000,
          lastSeen: Date.now(),
        }],
        timestamp: Date.now(),
      };

      const hmac = makeHmac(body, 'merge-psk');

      const first = await app.inject({
        method: 'POST',
        url: '/federation/sync',
        headers: { 'x-savannaguard-hmac': hmac },
        payload: body,
      });

      expect(first.statusCode).toBe(200);
      const firstResult = first.json() as Record<string, unknown>;
      expect(firstResult.merged).toBe(1);
      expect(firstResult.skipped).toBe(0);

      const second = await app.inject({
        method: 'POST',
        url: '/federation/sync',
        headers: { 'x-savannaguard-hmac': hmac },
        payload: body,
      });

      expect(second.statusCode).toBe(200);
      const secondResult = second.json() as Record<string, unknown>;
      expect(secondResult.skipped).toBe(1);
    } finally {
      await app.close();
      db.exec('DELETE FROM federation_sync_state;');
      db.exec('DELETE FROM federated_signature_reports;');
      db.exec('DELETE FROM federated_signatures;');
      db.exec('DELETE FROM federation_peers;');
    }
  });

  it('updates signature when higher confidence arrives', async () => {
    const app = buildServer();
    await app.ready();

    try {
      await addPeerViaAdmin(app, 'https://peer-test-merge2.example.com:19101', 'merge2-psk');

      const body1 = {
        type: 'push',
        signatures: [{
          hash: 'merge-hash-2',
          hashType: 'ip',
          confidence: 0.7,
          attackType: 'scraping',
          firstSeen: Date.now() - 1000,
          lastSeen: Date.now(),
        }],
        timestamp: Date.now(),
      };

      const hmac1 = makeHmac(body1, 'merge2-psk');
      await app.inject({
        method: 'POST',
        url: '/federation/sync',
        headers: { 'x-savannaguard-hmac': hmac1 },
        payload: body1,
      });

      const body2 = {
        type: 'push',
        signatures: [{
          hash: 'merge-hash-2',
          hashType: 'ip',
          confidence: 0.95,
          attackType: 'scraping',
          firstSeen: Date.now() - 2000,
          lastSeen: Date.now(),
        }],
        timestamp: Date.now(),
      };

      const hmac2 = makeHmac(body2, 'merge2-psk');
      const response = await app.inject({
        method: 'POST',
        url: '/federation/sync',
        headers: { 'x-savannaguard-hmac': hmac2 },
        payload: body2,
      });

      expect(response.statusCode).toBe(200);
      const result = response.json() as Record<string, unknown>;
      expect(result.merged).toBe(1);

      const sig = db.prepare(
        'SELECT confidence FROM federated_signatures WHERE hash = ? AND hash_type = ?'
      ).get('merge-hash-2', 'ip') as { confidence: number };
      expect(sig.confidence).toBeGreaterThanOrEqual(0.95);
    } finally {
      await app.close();
      db.exec('DELETE FROM federation_sync_state;');
      db.exec('DELETE FROM federated_signature_reports;');
      db.exec('DELETE FROM federated_signatures;');
      db.exec('DELETE FROM federation_peers;');
    }
  });
});

describe('federation SSRF validation', () => {
  it('rejects link-local IP (169.254.x.x) — AWS metadata endpoint', async () => {
    const app = buildServer();
    await app.ready();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/api/federation/peers',
        headers: adminCsrfHeaders(),
        payload: {
          peerUrl: 'http://169.254.169.254/latest/meta-data',
          psk: 'test-psk',
        },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('link-local');
    } finally {
      await app.close();
    }
  });

  it('rejects file:// scheme — local file access attempt', async () => {
    const app = buildServer();
    await app.ready();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/api/federation/peers',
        headers: adminCsrfHeaders(),
        payload: {
          peerUrl: 'file:///etc/passwd',
          psk: 'test-psk',
        },
      });
      // file:// is not http/https → invalid peer URL format
      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error).toContain('http');
    } finally {
      await app.close();
    }
  });

  it('rejects localhost variants', async () => {
    const app = buildServer();
    await app.ready();
    try {
      const localhosts = [
        'http://localhost:8080',
        'http://127.0.0.1:9000',
        'http://[::1]:8000',
      ];
      for (const url of localhosts) {
        const response = await app.inject({
          method: 'POST',
          url: '/admin/api/federation/peers',
          headers: adminCsrfHeaders(),
          payload: { peerUrl: url, psk: 'psk' },
        });
        expect(response.statusCode).toBe(400);
        const body = response.json() as { error: string };
        expect(body.error.toLowerCase()).toMatch(/localhost|private/);
      }
    } finally {
      await app.close();
    }
  });

  it('rejects non-routable hostname labels when private peers are disabled', async () => {
    const app = buildServer();
    await app.ready();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/api/federation/peers',
        headers: adminCsrfHeaders(),
        payload: {
          peerUrl: 'https://node-a:3000',
          psk: 'label-host-psk',
        },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error.toLowerCase()).toContain('routable hostname');
    } finally {
      await app.close();
    }
  });

  it('rejects private IP ranges (10.x, 172.16-31.x, 192.168.x)', async () => {
    const app = buildServer();
    await app.ready();
    try {
      const privateUrls = [
        'https://10.0.0.1:8080',
        'https://10.255.255.255:8080',
        'https://172.16.0.1:8080',
        'https://172.31.255.255:8080',
        'https://192.168.0.1:8080',
        'https://192.168.255.255:8080',
      ];
      for (const url of privateUrls) {
        const response = await app.inject({
          method: 'POST',
          url: '/admin/api/federation/peers',
          headers: adminCsrfHeaders(),
          payload: { peerUrl: url, psk: 'psk' },
        });
        expect(response.statusCode).toBe(400);
        const body = response.json() as { error: string };
        expect(body.error.toLowerCase()).toMatch(/private|invalid/);
      }
    } finally {
      await app.close();
    }
  });

  it('accepts public routable HTTPS URLs', async () => {
    const app = buildServer();
    await app.ready();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/api/federation/peers',
        headers: adminCsrfHeaders(),
        payload: {
          peerUrl: 'https://203.0.113.50:8080',
          psk: 'public-peer-psk',
        },
      });
      expect(response.statusCode).toBe(200);
      const added = response.json() as { status: string };
      expect(added.status).toBe('added');
    } finally {
      await app.close();
    }
  });

  it('rejects http protocol (only https allowed)', async () => {
    const app = buildServer();
    await app.ready();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/api/federation/peers',
        headers: adminCsrfHeaders(),
        payload: {
          peerUrl: 'http://203.0.113.50:8080',
          psk: 'http-psk',
        },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: string };
      expect(body.error.toLowerCase()).toMatch(/http|protocol/);
    } finally {
      await app.close();
    }
  });
});

describe('federation HMAC authentication', () => {
  it('accepts valid HMAC signature', async () => {
    const app = buildServer();
    await app.ready();
    try {
      await addPeerViaAdmin(app, 'https://peer-hmac-test.example.com:19150', 'hmac-psk');

      const body = {
        type: 'push',
        signatures: [{
          hash: 'hmac-test-hash',
          hashType: 'ip',
          confidence: 0.85,
          attackType: 'scraping',
          firstSeen: Date.now() - 1000,
          lastSeen: Date.now(),
        }],
        timestamp: Date.now(),
      };

      const hmac = makeHmac(body, 'hmac-psk');
      const response = await app.inject({
        method: 'POST',
        url: '/federation/sync',
        headers: { 'x-savannaguard-hmac': hmac },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const result = response.json() as Record<string, unknown>;
      expect(result.received).toBe(1);
    } finally {
      await app.close();
      db.exec('DELETE FROM federation_peers;');
    }
  });

  it('rejects wrong HMAC signature with 401', async () => {
    const app = buildServer();
    await app.ready();
    try {
      await addPeerViaAdmin(app, 'https://peer-hmac-wrong.example.com:19151', 'correct-psk');

      const body = {
        type: 'push',
        signatures: [{
          hash: 'hmac-wrong-hash',
          hashType: 'ip',
          confidence: 0.85,
          attackType: 'scraping',
          firstSeen: Date.now() - 1000,
          lastSeen: Date.now(),
        }],
        timestamp: Date.now(),
      };

      // Sign with WRONG PSK — should be rejected
      const wrongHmac = makeHmac(body, 'wrong-psk');
      const response = await app.inject({
        method: 'POST',
        url: '/federation/sync',
        headers: { 'x-savannaguard-hmac': wrongHmac },
        payload: body,
      });

      expect(response.statusCode).toBe(401);
      const result = response.json() as { error: string };
      expect(result.error.toLowerCase()).toMatch(/invalid|hmac|auth|unauthorized/);
    } finally {
      await app.close();
      db.exec('DELETE FROM federation_peers;');
    }
  });

  it('rejects tampered signature (valid format, wrong content)', async () => {
    const app = buildServer();
    await app.ready();
    try {
      await addPeerViaAdmin(app, 'https://peer-hmac-tamper.example.com:19152', 'tamper-psk');

      const body = {
        type: 'push',
        signatures: [{
          hash: 'hmac-tamper-hash',
          hashType: 'ip',
          confidence: 0.85,
          attackType: 'scraping',
          firstSeen: Date.now() - 1000,
          lastSeen: Date.now(),
        }],
        timestamp: Date.now(),
      };

      const validHmac = makeHmac(body, 'tamper-psk');
      // Tamper: change one character in the HMAC hex string
      const tamperedHmac = validHmac.slice(0, -1) + (validHmac.slice(-1) === 'a' ? 'b' : 'a');

      const response = await app.inject({
        method: 'POST',
        url: '/federation/sync',
        headers: { 'x-savannaguard-hmac': tamperedHmac },
        payload: body,
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
      db.exec('DELETE FROM federation_peers;');
    }
  });

  it('rejects missing HMAC header with 401', async () => {
    const app = buildServer();
    await app.ready();
    try {
      await addPeerViaAdmin(app, 'https://peer-no-hmac.example.com:19153', 'no-hmac-psk');

      const body = {
        type: 'push',
        signatures: [{ hash: 'no-hmac-hash', hashType: 'ip', confidence: 0.5, attackType: 'test', firstSeen: Date.now(), lastSeen: Date.now() }],
        timestamp: Date.now(),
      };

      const response = await app.inject({
        method: 'POST',
        url: '/federation/sync',
        // No x-savannaguard-hmac header
        payload: body,
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
      db.exec('DELETE FROM federation_peers;');
    }
  });
});

describe('federation offline peer backoff', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    logger.setLevel('error');
  });

  beforeEach(async () => {
    app = buildServer();
    await app.ready();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
    db.exec('DELETE FROM federation_sync_state;');
    db.exec('DELETE FROM federated_signature_reports;');
    db.exec('DELETE FROM federated_signatures;');
    db.exec('DELETE FROM federation_peers;');
  });

  it('does not attempt sync with banned peer', async () => {
    await addPeerViaAdmin(app, 'https://peer-test-banned.example.com:19997', 'banned-psk');

    // Manually set status to banned
    const peer = db.prepare('SELECT peer_id FROM federation_peers WHERE peer_url = ?').get('https://peer-test-banned.example.com:19997') as { peer_id: string };
    db.prepare("UPDATE federation_peers SET status = 'banned' WHERE peer_id = ?").run(peer.peer_id);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ received: 0, status: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const syncResponse = await app.inject({
      method: 'POST',
      url: '/admin/api/federation/sync',
      headers: adminCsrfHeaders(),
      payload: { peerUrl: 'https://peer-test-banned.example.com:19997' },
    });

    expect(syncResponse.statusCode).toBe(200);
    const result = syncResponse.json() as Record<string, unknown>;
    expect(result.errors).toContainEqual(expect.stringContaining('banned'));
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
