/// <reference types="vitest/globals" />
import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { db } from '../src/db.js';

interface AddedPeerResponse {
  peer: {
    peerId: string;
    peerUrl: string;
    lastSeen: number;
    trusted: boolean;
    status: string;
    psk?: string;
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
    errors: string[];
  }>;
}

function adminCookieHeader(): string {
  const password = process.env.ADMIN_PASSWORD ?? 'admin';
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  return `savanna_admin=${hash}`;
}

describe('federation routes', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  beforeEach(() => {
    db.exec('DELETE FROM federation_sync_state;');
    db.exec('DELETE FROM federated_signature_reports;');
    db.exec('DELETE FROM federated_signatures;');
    db.exec('DELETE FROM federation_peers;');
  });

  it('does not expose peer PSK in admin responses', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/admin/api/federation/peers',
      headers: {
        cookie: adminCookieHeader(),
      },
      payload: {
        peerUrl: 'http://127.0.0.1:18081',
        psk: 'top-secret-psk',
      },
    });

    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as AddedPeerResponse;
    expect(created.status).toBe('added');
    expect(created.peer.peerUrl).toBe('http://127.0.0.1:18081');
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
    expect(peers[0].peerUrl).toBe('http://127.0.0.1:18081');
    expect(peers[0].psk).toBeUndefined();
  });

  it('triggers sync for all peers when peerUrl is empty', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      // pullSignaturesFromPeer calls /federation/state
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
      // pushSignaturesToPeer calls /federation/sync
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
      headers: {
        cookie: adminCookieHeader(),
      },
      payload: {
        peerUrl: 'http://127.0.0.1:18081',
        psk: 'peer-a-psk',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/admin/api/federation/peers',
      headers: {
        cookie: adminCookieHeader(),
      },
      payload: {
        peerUrl: 'http://127.0.0.1:18082',
        psk: 'peer-b-psk',
      },
    });

    const syncResponse = await app.inject({
      method: 'POST',
      url: '/admin/api/federation/sync',
      headers: {
        cookie: adminCookieHeader(),
      },
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
      headers: {
        cookie: adminCookieHeader(),
      },
      payload: {
        peerUrl: 'http://127.0.0.1:19000',
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
});
