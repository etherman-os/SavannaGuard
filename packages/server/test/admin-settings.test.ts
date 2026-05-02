/// <reference types="vitest/globals" />
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { getAdaptivePowEnabled, setAdaptivePowEnabled, setBlockDatacenterIPs, setPowDifficulty } from '../src/db.js';
import { createAdminSessionCookie } from '../src/services/adminAuth.js';

const CSRF_TOKEN = 'test-csrf-token-admin-settings';

function adminCookieHeader(): string {
  return `savanna_admin=${createAdminSessionCookie()}; savanna_csrf=${CSRF_TOKEN}`;
}

function adminCsrfHeaders(): Record<string, string> {
  return {
    cookie: adminCookieHeader(),
    'x-requested-with': 'SavannaAdmin',
    'x-csrf-token': CSRF_TOKEN,
  };
}

describe('admin settings api', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    setPowDifficulty(4);
    setAdaptivePowEnabled(true);
    setBlockDatacenterIPs(false);
    app = buildServer();
    await app.ready();
  });

  afterEach(async () => {
    setPowDifficulty(4);
    setAdaptivePowEnabled(true);
    setBlockDatacenterIPs(false);
    await app.close();
  });

  it('returns settings from /admin/api/settings', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/api/settings',
      headers: {
        cookie: adminCookieHeader(),
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { difficulty: number; adaptiveEnabled: boolean; blockDatacenterIPs: boolean };
    expect(body).toHaveProperty('difficulty');
    expect(body).toHaveProperty('adaptiveEnabled');
    expect(body).toHaveProperty('blockDatacenterIPs');
    expect(typeof body.difficulty).toBe('number');
    expect(typeof body.adaptiveEnabled).toBe('boolean');
    expect(typeof body.blockDatacenterIPs).toBe('boolean');
  });

  it('updates settings through /admin/api/settings', async () => {
    const postRes = await app.inject({
      method: 'POST',
      url: '/admin/api/settings',
      headers: adminCsrfHeaders(),
      payload: {
        difficulty: 5,
        adaptiveEnabled: false,
        blockDatacenterIPs: true,
      },
    });

    expect(postRes.statusCode).toBe(200);
    const postBody = postRes.json() as { ok: boolean; difficulty: number; adaptiveEnabled: boolean; blockDatacenterIPs: boolean };
    expect(postBody.ok).toBe(true);
    expect(postBody.difficulty).toBe(5);
    expect(postBody.adaptiveEnabled).toBe(false);
    expect(postBody.blockDatacenterIPs).toBe(true);
    expect(getAdaptivePowEnabled()).toBe(false);

    const getRes = await app.inject({
      method: 'GET',
      url: '/admin/api/settings',
      headers: {
        cookie: adminCookieHeader(),
      },
    });

    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json() as { difficulty: number; adaptiveEnabled: boolean; blockDatacenterIPs: boolean };
    expect(getBody.difficulty).toBe(5);
    expect(getBody.adaptiveEnabled).toBe(false);
    expect(getBody.blockDatacenterIPs).toBe(true);
  });

  it('keeps legacy /admin/settings POST compatibility', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/settings',
      headers: adminCsrfHeaders(),
      payload: {
        difficulty: 6,
        blockDatacenterIPs: false,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; difficulty: number; blockDatacenterIPs: boolean };
    expect(body.ok).toBe(true);
    expect(body.difficulty).toBe(6);
    expect(body.blockDatacenterIPs).toBe(false);
  });

  it('rejects /admin/api/settings POST without csrf token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/api/settings',
      headers: {
        cookie: adminCookieHeader(),
        'x-requested-with': 'SavannaAdmin',
      },
      payload: {
        difficulty: 4,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Invalid CSRF token' });
  });
});
