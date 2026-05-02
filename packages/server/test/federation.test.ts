/// <reference types="vitest/globals" />
import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { db } from '../src/db.js';
import { logger } from '../src/services/logger.js';
import { createAdminSessionCookie } from '../src/services/adminAuth.js';

interface AddedPeerResponse {
  peer: {
    peerId: string;
    peerUrl: string;
    lastSeen: number;
    trusted: boolean;
    status: string;
    consecutiveFailures: number;
    lastFailureAt: number;
    lastFailureReason: string;
    lastSuccessAt: number;
  };
  status: string;
}

interface SyncAllResponse {
  mode: 'all';
  totalPeers: number;
  syncedPeers: number;
  failedPeers: number;
  results: Array<{
    peerUrl: string;
    received: number;
    merged: number;
    skipped: number;
    errors: string[];
  }>;
}

const CSRF_TOKEN = 'test-csrf-token-for-federation';

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

describe('federation routes', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
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

  it('does not expose peer PSK in admin responses', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/admin/api/federation/peers',
      headers: adminCsrfHeaders(),
      payload: {
        peerUrl: 'https://fed-peer-a.example.com:18081',
        psk: 'top-secret-psk',
      },
    });

    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as AddedPeerResponse;
    expect(created.status).toBe('added');
    expect(created.peer.peerUrl).toBe('https://fed-peer-a.example.com:18081');
    expect(created.peer.psk).toBeUndefined();

    const listResponse = await app.inject({
      method: 'GET',
      url: '/admin/api/federation/peers',
      headers: {
        cookie: adminCookieHeader(),
      },
    });

    expect(listResponse.statusCode).toBe(200);
    const peers = listResponse.json() as Array<Record<string, unknown>>;
    expect(peers.length).toBe(1);
    expect(peers[0].peerUrl).toBe('https://fed-peer-a.example.com:18081');
    expect(peers[0].psk).toBeUndefined();
  });

  it('includes peer health fields in admin responses', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/admin/api/federation/peers',
      headers: adminCsrfHeaders(),
      payload: {
        peerUrl: 'https://fed-peer-a.example.com:18081',
        psk: 'test-psk',
      },
    });

    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as AddedPeerResponse;
    expect(created.peer.consecutiveFailures).toBe(0);
    expect(created.peer.lastFailureReason).toBe('');
    expect(typeof created.peer.lastSuccessAt).toBe('number');
  });

  it('updates existing peer for same URL instead of creating duplicates', async () => {
    const peerUrl = 'https://fed-peer-dup.example.com:18083';

    const firstAdd = await app.inject({
      method: 'POST',
      url: '/admin/api/federation/peers',
      headers: adminCsrfHeaders(),
      payload: {
        peerUrl,
        psk: 'first-psk',
      },
    });

    expect(firstAdd.statusCode).toBe(200);

    db.prepare(
      `UPDATE federation_peers
       SET status = 'offline', consecutive_failures = 5, last_failure_reason = 'old-failure'
       WHERE peer_url = ?`
    ).run(peerUrl);

    const secondAdd = await app.inject({
      method: 'POST',
      url: '/admin/api/federation/peers',
      headers: adminCsrfHeaders(),
      payload: {
        peerUrl: `${peerUrl}/`,
        psk: 'second-psk',
      },
    });

    expect(secondAdd.statusCode).toBe(200);

    const rows = db.prepare(
      `SELECT peer_id, peer_url, psk, status, consecutive_failures, last_failure_reason
       FROM federation_peers
       WHERE peer_url = ?`
    ).all(peerUrl) as Array<{
      peer_id: string;
      peer_url: string;
      psk: string;
      status: string;
      consecutive_failures: number;
      last_failure_reason: string;
    }>;

    expect(rows.length).toBe(1);
    expect(rows[0].peer_url).toBe(peerUrl);
    expect(rows[0].psk).toBe('second-psk');
    expect(rows[0].status).toBe('active');
    expect(rows[0].consecutive_failures).toBe(0);
    expect(rows[0].last_failure_reason).toBe('');

    const listResponse = await app.inject({
      method: 'GET',
      url: '/admin/api/federation/peers',
      headers: {
        cookie: adminCookieHeader(),
      },
    });

    expect(listResponse.statusCode).toBe(200);
    const peers = listResponse.json() as Array<Record<string, unknown>>;
    expect(peers.length).toBe(1);
  });

  it('triggers sync for all peers when peerUrl is empty', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/federation/state')) {
        return new Response(JSON.stringify({
          signatures: [],
          stateHash: 'state-hash',
          syncVersion: 1,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/federation/sync')) {
        return new Response(JSON.stringify({ received: 0, status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ received: 0, status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await app.inject({
      method: 'POST',
      url: '/admin/api/federation/peers',
      headers: adminCsrfHeaders(),
      payload: {
        peerUrl: 'https://fed-peer-a.example.com:18081',
        psk: 'peer-a-psk',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/admin/api/federation/peers',
      headers: adminCsrfHeaders(),
      payload: {
        peerUrl: 'https://fed-peer-b.example.com:18082',
        psk: 'peer-b-psk',
      },
    });

    const syncResponse = await app.inject({
      method: 'POST',
      url: '/admin/api/federation/sync',
      headers: adminCsrfHeaders(),
      payload: {
        peerUrl: '',
      },
    });

    expect(syncResponse.statusCode).toBe(200);
    const result = syncResponse.json() as SyncAllResponse;
    expect(result.mode).toBe('all');
    expect(result.totalPeers).toBe(2);
    expect(result.results.length).toBe(2);
    expect(fetchMock).toHaveBeenCalled();

    const syncStateRows = db.prepare(
      'SELECT peer_id, last_hash, sync_version FROM federation_sync_state ORDER BY peer_id'
    ).all() as Array<{ peer_id: string; last_hash: string; sync_version: number }>;

    expect(syncStateRows.length).toBe(2);
    expect(syncStateRows.every((row) => row.last_hash === 'state-hash')).toBe(true);
    expect(syncStateRows.every((row) => row.sync_version === 1)).toBe(true);

    vi.unstubAllGlobals();
  });

  it('does not inflate reporter count for duplicate reports from the same peer', async () => {
    const addResponse = await app.inject({
      method: 'POST',
      url: '/admin/api/federation/peers',
      headers: adminCsrfHeaders(),
      payload: {
        peerUrl: 'https://fed-peer-single.example.com:19000',
        psk: 'single-peer-psk',
      },
    });

    expect(addResponse.statusCode).toBe(200);
    const addedPeer = addResponse.json() as AddedPeerResponse;

    const body = {
      type: 'push',
      signatures: [
        {
          hash: 'fed-hash-1',
          hashType: 'ip',
          confidence: 0.92,
          attackType: 'scraping',
          firstSeen: Date.now() - 1000,
          lastSeen: Date.now(),
        },
      ],
      timestamp: Date.now(),
    };

    const hmac = crypto
      .createHmac('sha256', 'single-peer-psk')
      .update(JSON.stringify(body))
      .digest('hex');

    const first = await app.inject({
      method: 'POST',
      url: '/federation/sync',
      headers: {
        'x-savannaguard-hmac': hmac,
      },
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as Record<string, unknown>).merged).toBe(1);
    expect((first.json() as Record<string, unknown>).skipped).toBe(0);

    const second = await app.inject({
      method: 'POST',
      url: '/federation/sync',
      headers: {
        'x-savannaguard-hmac': hmac,
      },
      payload: body,
    });
    expect(second.statusCode).toBe(200);

    const signature = db.prepare(
      'SELECT reporter_count, source_peer FROM federated_signatures WHERE hash = ? AND hash_type = ?'
    ).get('fed-hash-1', 'ip') as { reporter_count: number; source_peer: string } | undefined;

    expect(signature).toBeDefined();
    expect(signature?.reporter_count).toBe(1);
    expect(signature?.source_peer).toBe(addedPeer.peer.peerId);

    const reports = db.prepare(
      'SELECT COUNT(*) as c FROM federated_signature_reports WHERE hash = ? AND hash_type = ?'
    ).get('fed-hash-1', 'ip') as { c: number };
    expect(reports.c).toBe(1);
  });

  it('skips merge when remote confidence is not higher and peer already reported', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/api/federation/peers',
      headers: adminCsrfHeaders(),
      payload: {
        peerUrl: 'https://fed-peer-skip.example.com:19001',
        psk: 'skip-psk',
      },
    });

    const body = {
      type: 'push',
      signatures: [
        {
          hash: 'skip-hash-1',
          hashType: 'ip',
          confidence: 0.9,
          attackType: 'scraping',
          firstSeen: Date.now() - 5000,
          lastSeen: Date.now(),
        },
      ],
      timestamp: Date.now(),
    };

    const hmac = crypto
      .createHmac('sha256', 'skip-psk')
      .update(JSON.stringify(body))
      .digest('hex');

    await app.inject({
      method: 'POST',
      url: '/federation/sync',
      headers: {
        'x-savannaguard-hmac': hmac,
      },
      payload: body,
    });

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/federation/sync',
      headers: {
        'x-savannaguard-hmac': hmac,
      },
      payload: body,
    });

    expect(secondResponse.statusCode).toBe(200);
    const resultBody = secondResponse.json() as Record<string, unknown>;
    expect(resultBody.skipped).toBe(1);
  });

  it('returns federation state hash over GET /federation/state', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/federation/state',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { stateHash: string; signatureCount: number };
    expect(typeof body.stateHash).toBe('string');
    expect(body.stateHash.length).toBe(64);
    expect(typeof body.signatureCount).toBe('number');
  });

  it('rejects oversized payloads with 413', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/api/federation/peers',
      headers: adminCsrfHeaders(),
      payload: {
        peerUrl: 'https://fed-peer-payload.example.com:19002',
        psk: 'payload-psk',
      },
    });

    const hugeSignatures = Array.from({ length: 50000 }, (_, i) => ({
      hash: `hash-${i}-${'x'.repeat(100)}`,
      hashType: 'ip',
      confidence: 0.9,
      attackType: 'scraping',
      firstSeen: Date.now() - 1000,
      lastSeen: Date.now(),
    }));

    const body = {
      type: 'push',
      signatures: hugeSignatures,
      timestamp: Date.now(),
    };

    const hmac = crypto
      .createHmac('sha256', 'payload-psk')
      .update(JSON.stringify(body))
      .digest('hex');

    const response = await app.inject({
      method: 'POST',
      url: '/federation/sync',
      headers: {
        'x-savannaguard-hmac': hmac,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(413);
  });

  it('includes offlinePeerCount in federation stats', async () => {
    const statsResponse = await app.inject({
      method: 'GET',
      url: '/admin/api/federation/stats',
      headers: {
        cookie: adminCookieHeader(),
      },
    });

    expect(statsResponse.statusCode).toBe(200);
    const stats = statsResponse.json() as Record<string, unknown>;
    expect(stats).toHaveProperty('offlinePeerCount');
    expect(stats).toHaveProperty('activePeerCount');
    expect(stats).toHaveProperty('peerCount');
  });
});
