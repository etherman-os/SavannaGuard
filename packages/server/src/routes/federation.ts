/**
 * Federation API Routes
 *
 * Endpoints for peer-to-peer gossip protocol:
 * - POST /federation/sync - Receive push from a peer
 * - GET /federation/state - Get current state hash
 * - POST /federation/state - Backward-compatible pull endpoint
 * - POST /federation/push - Pull signatures from this peer
 * - GET /admin/api/federation/peers - List peers (admin)
 * - POST /admin/api/federation/peers - Add peer (admin)
 * - DELETE /admin/api/federation/peers/:id - Remove peer (admin)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import {
  addPeer,
  removePeer,
  listPeers,
  listPublicPeers,
  toPublicPeer,
  syncWithPeer,
  syncWithAllPeers,
  getFederationStats,
  getTopFederatedSignatures,
  recordFederatedSignature,
} from '../services/federation.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';

const ADMIN_COOKIE_NAME = 'savanna_admin';
const MAX_PAYLOAD_BYTES = Number.isFinite(config.federation.maxPayloadBytes) && config.federation.maxPayloadBytes > 0
  ? config.federation.maxPayloadBytes
  : 5 * 1024 * 1024;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf-8');
  const rightBuffer = Buffer.from(right, 'utf-8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function currentAdminCookieValue(): string {
  return sha256(config.adminPassword);
}

function verifyPassword(token: string | undefined): boolean {
  if (!token) return false;
  return safeEquals(token, currentAdminCookieValue());
}

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (verifyPassword(request.cookies[ADMIN_COOKIE_NAME])) return true;
  reply.status(401).send({ error: 'Unauthorized' });
  return false;
}

function requireAdminCsrf(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!requireAdmin(request, reply)) return false;
  const header = request.headers['x-requested-with'] ?? '';
  if (typeof header !== 'string' || header !== 'SavannaAdmin') {
    reply.status(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function federationRoutes(app: FastifyInstance) {
  function resolveAuthenticatedPeer(payload: string, signature: string) {
    const peers = listPeers();
    let matchedPeer: ReturnType<typeof listPeers>[0] | null = null;

    for (const peer of peers) {
      const expected = crypto.createHmac('sha256', peer.psk).update(payload).digest('hex');
      if (expected.length !== signature.length) continue;
      try {
        const isValid = crypto.timingSafeEqual(
          Buffer.from(expected, 'utf-8'),
          Buffer.from(signature, 'utf-8'),
        );
        if (isValid) {
          matchedPeer = peer;
          break;
        }
      } catch {
        // timingSafeEqual throws if buffers are different lengths (already checked above)
      }
    }

    return matchedPeer;
  }

  async function handleStateRequest(req: FastifyRequest, rep: FastifyReply) {
    const hmac = req.headers['x-savannaguard-hmac'] as string | undefined;
    if (!hmac) {
      return rep.status(401).send({ error: 'Missing HMAC signature' });
    }

    const body = (req.body ?? {}) as {
      type?: string;
      lastHash?: string;
      syncVersion?: number;
    };

    const payload = JSON.stringify(body);
    const peer = resolveAuthenticatedPeer(payload, hmac);
    if (!peer) {
      logger.warn('federation:auth', 'HMAC authentication failed on /state endpoint');
      return rep.status(401).send({ error: 'Invalid HMAC signature' });
    }

    logger.debug('federation:state', 'Serving state request', { peerUrl: peer.peerUrl });

    const signatures = getTopFederatedSignatures(1000);
    const stateHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(signatures.map(s => `${s.hash}:${s.hashType}`)))
      .digest('hex');

    return {
      signatures,
      stateHash,
      syncVersion: (body.syncVersion ?? 0) + 1,
    };
  }

  // ============================================
  // Peer-to-peer sync endpoints (authenticated via HMAC)
  // ============================================

  /**
   * POST /federation/sync
   * Receive pushed signatures from another peer
   */
  app.post('/federation/sync', {
    bodyLimit: MAX_PAYLOAD_BYTES,
  }, async (req, rep) => {
    const hmac = req.headers['x-savannaguard-hmac'] as string | undefined;
    if (!hmac) {
      return rep.status(401).send({ error: 'Missing HMAC signature' });
    }

    const body = (req.body ?? {}) as {
      type?: string;
      signatures?: Array<{
        hash: string;
        hashType: string;
        confidence: number;
        attackType?: string;
        firstSeen: number;
        lastSeen: number;
      }>;
      timestamp?: number;
    };

    if (!body.signatures || !Array.isArray(body.signatures)) {
      return rep.status(400).send({ error: 'Invalid payload' });
    }

    const payload = JSON.stringify(body);
    const peer = resolveAuthenticatedPeer(payload, hmac);

    if (!peer) {
      logger.warn('federation:auth', 'HMAC authentication failed on /sync endpoint');
      return rep.status(401).send({ error: 'Invalid HMAC signature' });
    }

    // Record all signatures with validation
    let merged = 0;
    let skipped = 0;
    for (const sig of body.signatures) {
      const hash = String(sig.hash ?? '').slice(0, 128);
      const hashType = ['ip', 'ua', 'combined'].includes(sig.hashType) ? sig.hashType : 'ip';
      const attackType = String(sig.attackType ?? 'unknown').slice(0, 50);
      const confidence = Math.max(0, Math.min(1, Number(sig.confidence ?? 0)));

      const result = recordFederatedSignature(hash, hashType, attackType, confidence, peer.peerId);
      if (result.merged) merged++;
      if (result.skipped) skipped++;
    }

    logger.info('federation:sync', 'Received pushed signatures', {
      peerUrl: peer.peerUrl,
      received: String(body.signatures.length),
      merged: String(merged),
      skipped: String(skipped),
    });

    return { received: body.signatures.length, merged, skipped, status: 'ok' };
  });

  /**
   * POST /federation/state
   * Respond to pull request with our signatures
   */
  app.post('/federation/state', async (req, rep) => {
    return handleStateRequest(req, rep);
  });

  /**
   * POST /federation/push
   * Compatibility alias for peers requesting our signatures
   */
  app.post('/federation/push', async (req, rep) => {
    return handleStateRequest(req, rep);
  });

  /**
   * GET /federation/state
   * Public state hash for lightweight sync verification
   */
  app.get('/federation/state', async () => {
    const signatures = getTopFederatedSignatures(1000);
    const stateHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(signatures.map(s => `${s.hash}:${s.hashType}`)))
      .digest('hex');

    return {
      stateHash,
      signatureCount: signatures.length,
    };
  });

  // ============================================
  // Admin endpoints (cookie auth required)
  // ============================================

  /**
   * GET /admin/api/federation/peers
   * List all configured peers
   */
  app.get('/admin/api/federation/peers', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;
    return listPublicPeers();
  });

  /**
   * POST /admin/api/federation/peers
   * Add a new peer
   */
  app.post('/admin/api/federation/peers', async (req, rep) => {
    if (!requireAdminCsrf(req, rep)) return;

    const body = req.body as { peerUrl?: string; psk?: string };
    if (!body.peerUrl || !body.psk) {
      return rep.status(400).send({ error: 'peerUrl and psk required' });
    }

    try {
      const peer = addPeer(body.peerUrl, body.psk);
      logger.info('federation:peer', 'New peer added via admin', { peerUrl: body.peerUrl });
      return { peer: toPublicPeer(peer), status: 'added' };
    } catch (err) {
      return rep.status(400).send({ error: (err as Error).message });
    }
  });

  /**
   * DELETE /admin/api/federation/peers/:peerId
   * Remove a peer
   */
  app.delete('/admin/api/federation/peers/:peerId', async (req, rep) => {
    if (!requireAdminCsrf(req, rep)) return;

    const { peerId } = req.params as { peerId: string };
    removePeer(peerId);
    return { status: 'removed' };
  });

  /**
   * POST /admin/api/federation/sync
   * Trigger manual sync with a specific peer or all peers
   */
  app.post('/admin/api/federation/sync', async (req, rep) => {
    if (!requireAdminCsrf(req, rep)) return;

    const body = (req.body ?? {}) as { peerUrl?: string };
    if (!body.peerUrl || body.peerUrl.trim().length === 0) {
      const result = await syncWithAllPeers();
      return {
        mode: 'all',
        ...result,
      };
    }

    const result = await syncWithPeer(body.peerUrl);
    return {
      mode: 'single',
      peerUrl: body.peerUrl,
      ...result,
    };
  });

  /**
   * GET /admin/api/federation/stats
   * Get federation statistics
   */
  app.get('/admin/api/federation/stats', async (req, rep) => {
    if (!requireAdmin(req, rep)) return;

    const stats = getFederationStats();
    const topSignatures = getTopFederatedSignatures(10);

    return {
      ...stats,
      topSignatures,
    };
  });
}