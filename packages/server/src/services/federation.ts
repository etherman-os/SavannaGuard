/**
 * Federation Service
 *
 * Peer-to-peer gossip protocol for sharing bot signatures across
 * self-hosted SavannaGuard instances without a central server.
 *
 * Security:
 * - All shared data is hashed (SHA256(ipHash + behavioralFingerprint))
 * - No raw IPs, user agents, or identifiable data leaves the instance
 * - Peers authenticate via pre-shared key (HMAC)
 * - Manual trust model (v1) - admins explicitly add trusted peers
 *
 * Error Handling:
 * - Peer failures tracked with consecutive failure count
 * - Peers marked offline after threshold consecutive failures
 * - Offline peers synced on slower schedule (30min vs 5min)
 * - Automatic recovery: offline peer success → active
 * - Exponential backoff with jitter for retries
 * - CRDT merge skip: no-op when remote data is not an improvement
 */

import { db } from '../db.js';
import crypto from 'crypto';
import { config } from '../config.js';
import { logger } from './logger.js';
import {
  FederationError,
  ParseError,
  PayloadTooLargeError,
  classifyFetchError,
  classifyHttpResponse,
} from './federation-errors.js';
import { retryWithBackoff } from './retry.js';

export interface FederatedSignature {
  hash: string;
  hashType: 'ip' | 'ua' | 'combined';
  attackType: string;
  confidence: number;
  reporterCount: number;
  firstSeen: number;
  lastSeen: number;
  sourcePeer: string;
}

export interface FederationPeer {
  peerId: string;
  peerUrl: string;
  psk: string;
  lastSeen: number;
  trusted: boolean;
  status: 'active' | 'offline' | 'banned';
  consecutiveFailures: number;
  lastFailureAt: number;
  lastFailureReason: string;
  lastSuccessAt: number;
}

export interface FederationPeerPublic {
  peerId: string;
  peerUrl: string;
  lastSeen: number;
  trusted: boolean;
  status: 'active' | 'offline' | 'banned';
  consecutiveFailures: number;
  lastFailureAt: number;
  lastFailureReason: string;
  lastSuccessAt: number;
}

export interface FederatedResult {
  isKnownBot: boolean;
  confidence: number;
  source: 'federation';
  attackType?: string;
}

export interface MergeResult {
  merged: boolean;
  skipped: boolean;
  reason?: string;
}

export interface SyncResult {
  received: number;
  merged: number;
  skipped: number;
  errors: string[];
}

export interface SyncAllResult {
  totalPeers: number;
  syncedPeers: number;
  failedPeers: number;
  results: Array<{ peerUrl: string; received: number; merged: number; skipped: number; errors: string[] }>;
}

interface PullResult {
  signatures: FederatedSignature[];
  stateHash: string;
  syncVersion: number;
}

const FEDERATION_CONFIG = {
  enabled: config.federation.enabled,
  peerUrls: config.federation.peerUrls,
  syncIntervalMs: Number.isFinite(config.federation.syncIntervalMs) ? Math.max(1000, config.federation.syncIntervalMs) : 300000,
  minConfidence: Number.isFinite(config.federation.minConfidence) ? Math.max(0, Math.min(1, config.federation.minConfidence)) : 0.7,
  minReporters: Number.isFinite(config.federation.minReporters) ? Math.max(1, config.federation.minReporters) : 2,
  psk: config.federation.psk,
  requestTimeoutMs: Number.isFinite(config.federation.requestTimeoutMs) ? Math.max(1000, config.federation.requestTimeoutMs) : 30000,
  maxRetries: Number.isFinite(config.federation.maxRetries) ? Math.max(0, config.federation.maxRetries) : 3,
  baseRetryDelayMs: Number.isFinite(config.federation.baseRetryDelayMs) ? Math.max(0, config.federation.baseRetryDelayMs) : 5000,
  maxRetryDelayMs: Number.isFinite(config.federation.maxRetryDelayMs) ? Math.max(config.federation.baseRetryDelayMs, config.federation.maxRetryDelayMs) : 60000,
  offlineSyncIntervalMs: Number.isFinite(config.federation.offlineSyncIntervalMs) ? Math.max(60000, config.federation.offlineSyncIntervalMs) : 1800000,
  offlineThreshold: Number.isFinite(config.federation.offlineThreshold) ? Math.max(1, config.federation.offlineThreshold) : 3,
  maxPayloadBytes: Number.isFinite(config.federation.maxPayloadBytes) ? Math.max(1024, config.federation.maxPayloadBytes) : 5242880,
};

let activeSyncInterval: ReturnType<typeof setInterval> | null = null;
let offlineSyncInterval: ReturnType<typeof setInterval> | null = null;

interface DbPeerRow {
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

function mapPeerRow(row: DbPeerRow): FederationPeer {
  return {
    peerId: row.peer_id,
    peerUrl: row.peer_url,
    psk: row.psk,
    lastSeen: row.last_seen,
    trusted: row.trusted === 1,
    status: row.status as 'active' | 'offline' | 'banned',
    consecutiveFailures: row.consecutive_failures ?? 0,
    lastFailureAt: row.last_failure_at ?? 0,
    lastFailureReason: row.last_failure_reason ?? '',
    lastSuccessAt: row.last_success_at ?? 0,
  };
}

/**
 * Validate peer URL to prevent SSRF attacks.
 * Rejects localhost, private/reserved IP ranges, and non-HTTP protocols.
 */
function validatePeerUrl(peerUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(peerUrl);
  } catch {
    throw new Error('Invalid peer URL format');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject localhost variants
  // Normalize IPv6 addresses by stripping brackets
  const normalizedHostname = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  if (hostname === 'localhost' || normalizedHostname === '::1' || normalizedHostname === '127.0.0.1') {
    throw new Error('Peer URL cannot reference localhost');
  }

  // Reject link-local / metadata endpoints (169.254.x.x)
  if (hostname.startsWith('169.254.')) {
    throw new Error('Peer URL cannot reference link-local range (169.254.x.x)');
  }

  // Reject private IP ranges: 10.x.x.x, 172.16.x.x-172.31.x.x, 192.168.x.x
  const parts = hostname.split('.');
  if (parts.length === 4) {
    const [a, b] = parts.map(Number);
    if (a === 10) throw new Error('Peer URL cannot reference private range (10.x.x.x)');
    if (a === 172 && b >= 16 && b <= 31) {
      throw new Error('Peer URL cannot reference private range (172.16.x.x-172.31.x.x)');
    }
    if (a === 192 && b === 168) {
      throw new Error('Peer URL cannot reference private range (192.168.x.x)');
    }
  }

  // Reject numeric IPv4 addresses in private/reserved ranges
  const ip = parts.map(Number);
  if (ip.length === 4 && ip.every(n => !isNaN(n) && n >= 0 && n <= 255)) {
    const ipInt = (ip[0] << 24 | ip[1] << 16 | ip[2] << 8 | ip[3]) >>> 0;
    // 10.0.0.0/8
    if ((ipInt & 0xff000000) === 0x0a000000) throw new Error('Peer URL cannot reference private range (10.x.x.x)');
    // 172.16.0.0/12
    if ((ipInt & 0xfff00000) === 0xac100000) throw new Error('Peer URL cannot reference private range (172.16.x.x-172.31.x.x)');
    // 192.168.0.0/16
    if ((ipInt & 0xffff0000) === 0xc0a80000) throw new Error('Peer URL cannot reference private range (192.168.x.x)');
    // 169.254.0.0/16 (link-local)
    if ((ipInt & 0xffff0000) === 0xa9fe0000) throw new Error('Peer URL cannot reference link-local range (169.254.x.x)');
  }

  // Finally, reject non-https protocols
  const protocol = parsed.protocol;
  if (protocol !== 'https:') {
    throw new Error('Peer URL must use https protocol');
  }
}

/**
 * Add a new peer to the trusted peer list
 */
export function addPeer(peerUrl: string, psk: string): FederationPeer {
  validatePeerUrl(peerUrl);
  const peerId = crypto.randomUUID();
  const now = Date.now();

  db.prepare(
    `INSERT INTO federation_peers (peer_id, peer_url, psk, last_seen, trusted, status, consecutive_failures, last_failure_at, last_failure_reason, last_success_at)
     VALUES (?, ?, ?, ?, 1, 'active', 0, 0, '', ?)`
  ).run(peerId, peerUrl, psk, now, now);

  logger.info('federation:peer', 'Peer added', { peerUrl, peerId });

  return {
    peerId,
    peerUrl,
    psk,
    lastSeen: now,
    trusted: true,
    status: 'active',
    consecutiveFailures: 0,
    lastFailureAt: 0,
    lastFailureReason: '',
    lastSuccessAt: now,
  };
}

/**
 * Remove a peer from the trusted peer list
 */
export function removePeer(peerId: string): void {
  db.prepare('DELETE FROM federation_peers WHERE peer_id = ?').run(peerId);
  db.prepare('DELETE FROM federation_sync_state WHERE peer_id = ?').run(peerId);
  logger.info('federation:peer', 'Peer removed', { peerId });
}

/**
 * List all configured peers
 */
export function listPeers(): FederationPeer[] {
  const rows = db.prepare('SELECT * FROM federation_peers').all() as DbPeerRow[];
  return rows.map(mapPeerRow);
}

export function toPublicPeer(peer: FederationPeer): FederationPeerPublic {
  return {
    peerId: peer.peerId,
    peerUrl: peer.peerUrl,
    lastSeen: peer.lastSeen,
    trusted: peer.trusted,
    status: peer.status,
    consecutiveFailures: peer.consecutiveFailures,
    lastFailureAt: peer.lastFailureAt,
    lastFailureReason: peer.lastFailureReason,
    lastSuccessAt: peer.lastSuccessAt,
  };
}

export function listPublicPeers(): FederationPeerPublic[] {
  return listPeers().map(toPublicPeer);
}

/**
 * Get peer by URL
 */
export function getPeerByUrl(peerUrl: string): FederationPeer | null {
  const row = db.prepare('SELECT * FROM federation_peers WHERE peer_url = ?').get(peerUrl) as DbPeerRow | undefined;

  if (!row) return null;

  return mapPeerRow(row);
}

/**
 * Get peer by ID
 */
export function getPeerById(peerId: string): FederationPeer | null {
  const row = db.prepare('SELECT * FROM federation_peers WHERE peer_id = ?').get(peerId) as DbPeerRow | undefined;

  if (!row) return null;

  return mapPeerRow(row);
}

/**
 * Mark peer as having a failure — increments consecutive_failures and possibly transitions to offline
 */
function markPeerFailure(peer: FederationPeer, reason: string): void {
  const newFailureCount = peer.consecutiveFailures + 1;
  const now = Date.now();
  const newStatus: FederationPeer['status'] = newFailureCount >= FEDERATION_CONFIG.offlineThreshold ? 'offline' : peer.status;

  db.prepare(
    `UPDATE federation_peers
     SET consecutive_failures = ?, last_failure_at = ?, last_failure_reason = ?, status = ?
     WHERE peer_id = ?`
  ).run(newFailureCount, now, reason.slice(0, 200), newStatus, peer.peerId);

  if (newStatus === 'offline' && peer.status !== 'offline') {
    logger.warn('federation:peer:offline', 'Peer marked offline after consecutive failures', {
      peerUrl: peer.peerUrl,
      consecutiveFailures: String(newFailureCount),
      reason,
    });
  } else {
    logger.warn('federation:peer:failure', 'Peer sync failed', {
      peerUrl: peer.peerUrl,
      consecutiveFailures: String(newFailureCount),
      reason,
    });
  }
}

/**
 * Mark peer as having a success — resets consecutive_failures, updates last_seen and last_success_at, restores active status
 */
function markPeerSuccess(peer: FederationPeer): void {
  const now = Date.now();
  const wasOffline = peer.status === 'offline';

  db.prepare(
    `UPDATE federation_peers
     SET consecutive_failures = 0, last_failure_at = 0, last_failure_reason = '', status = 'active', last_seen = ?, last_success_at = ?
     WHERE peer_id = ?`
  ).run(now, now, peer.peerId);

  if (wasOffline) {
    logger.info('federation:peer:recovered', 'Peer recovered from offline status', {
      peerUrl: peer.peerUrl,
      afterFailures: String(peer.consecutiveFailures),
    });
  }
}

/**
 * Check if a signature is known in the federated database
 */
export function checkFederatedSignature(hash: string, hashType: string): FederatedResult | null {
  if (!FEDERATION_CONFIG.enabled) return null;

  const row = db.prepare(
    'SELECT * FROM federated_signatures WHERE hash = ? AND hash_type = ?'
  ).get(hash, hashType) as {
    hash: string;
    hash_type: string;
    attack_type: string;
    confidence: number;
    reporter_count: number;
    first_seen: number;
    last_seen: number;
    source_peer: string;
  } | undefined;

  if (!row) return null;

  if (row.reporter_count >= FEDERATION_CONFIG.minReporters && row.confidence >= FEDERATION_CONFIG.minConfidence) {
    return {
      isKnownBot: true,
      confidence: row.confidence,
      source: 'federation',
      attackType: row.attack_type,
    };
  }

  return null;
}

/**
 * Record a signature received from federation (from another peer).
 * CRDT merge rules — skip writes when remote data is not an improvement.
 */
export function recordFederatedSignature(
  hash: string,
  hashType: string,
  attackType: string,
  confidence: number,
  sourcePeer: string,
): MergeResult {
  const now = Date.now();

  const existing = db.prepare(
    'SELECT confidence, reporter_count, attack_type FROM federated_signatures WHERE hash = ? AND hash_type = ?'
  ).get(hash, hashType) as { confidence: number; reporter_count: number; attack_type: string } | undefined;

  // Check if this peer already reported this signature
  const alreadyReported = db.prepare(
    'SELECT 1 FROM federated_signature_reports WHERE hash = ? AND hash_type = ? AND peer_id = ?'
  ).get(hash, hashType, sourcePeer);

  if (existing) {
    const confidenceNotImproved = confidence <= existing.confidence;
    const attackTypeNotImproved = attackType === 'unknown' || existing.attack_type !== 'unknown' || existing.attack_type === attackType;

    if (alreadyReported && confidenceNotImproved && attackTypeNotImproved) {
      logger.debug('federation:merge', 'Merge skipped — no improvement', {
        hash: hash.slice(0, 16),
        localConfidence: String(existing.confidence),
        remoteConfidence: String(confidence),
      });
      return { merged: false, skipped: true, reason: 'no_improvement' };
    }

    if (confidenceNotImproved && attackTypeNotImproved) {
      // Only the new reporter counts
      if (!alreadyReported) {
        db.prepare(
          `INSERT INTO federated_signature_reports (hash, hash_type, peer_id, reported_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(hash, hash_type, peer_id) DO NOTHING`
        ).run(hash, hashType, sourcePeer, now);

        db.prepare(
          `UPDATE federated_signatures
           SET reporter_count = reporter_count + 1, last_seen = ?
           WHERE hash = ? AND hash_type = ?`
        ).run(now, hash, hashType);

        logger.debug('federation:merge', 'Merge — new reporter added', {
          hash: hash.slice(0, 16),
          reporterCount: String(existing.reporter_count + 1),
        });
        return { merged: true, skipped: false };
      }

      return { merged: false, skipped: true, reason: 'already_reported' };
    }

    // Meaningful update — higher confidence or better attack type
    logger.info('federation:merge', 'Merge — signature updated', {
      hash: hash.slice(0, 16),
      localConfidence: String(existing.confidence),
      remoteConfidence: String(confidence),
      winner: confidence > existing.confidence ? 'remote' : 'local',
    });
  }

  // Insert or update signature
  db.prepare(
    `INSERT INTO federated_signatures
     (hash, hash_type, attack_type, confidence, reporter_count, first_seen, last_seen, source_peer)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(hash, hash_type) DO UPDATE SET
       confidence = MAX(confidence, excluded.confidence),
       attack_type = CASE
         WHEN federated_signatures.attack_type = 'unknown' AND excluded.attack_type != 'unknown'
           THEN excluded.attack_type
         ELSE federated_signatures.attack_type
       END,
       last_seen = MAX(federated_signatures.last_seen, excluded.last_seen)`
  ).run(hash, hashType, attackType, confidence, now, now, sourcePeer);

  const reportInsert = db.prepare(
    `INSERT INTO federated_signature_reports (hash, hash_type, peer_id, reported_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(hash, hash_type, peer_id) DO NOTHING`
  ).run(hash, hashType, sourcePeer, now);

  if (reportInsert.changes > 0) {
    db.prepare(
      `UPDATE federated_signatures
       SET reporter_count = reporter_count + 1, last_seen = ?
       WHERE hash = ? AND hash_type = ?`
    ).run(now, hash, hashType);
  }

  if (!existing) {
    logger.info('federation:merge', 'Merge — new signature inserted', {
      hash: hash.slice(0, 16),
      attackType,
      confidence: String(confidence),
      sourcePeer: sourcePeer.slice(0, 12),
    });
  }

  return { merged: true, skipped: false };
}

/**
 * Validate payload size from Content-Length header before parsing.
 */
function checkPayloadSize(response: Response, peerUrl: string): void {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const bytes = parseInt(contentLength, 10);
    if (Number.isFinite(bytes) && bytes > FEDERATION_CONFIG.maxPayloadBytes) {
      throw new PayloadTooLargeError(peerUrl, bytes, FEDERATION_CONFIG.maxPayloadBytes);
    }
  }
}

/**
 * Push our new signatures to a peer
 */
async function pushSignaturesToPeer(peer: FederationPeer): Promise<void> {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const signatures = db.prepare(
    `SELECT bs.hash, bs.hash_type, bs.match_count, bs.first_seen, bs.last_seen, 'local' as source
     FROM bot_signatures bs
     WHERE bs.last_seen > ?
     ORDER BY bs.last_seen DESC
     LIMIT 100`
  ).all(oneHourAgo) as Array<{
    hash: string;
    hash_type: string;
    match_count: number;
    first_seen: number;
    last_seen: number;
    source: string;
  }>;

  if (signatures.length === 0) {
    logger.debug('federation:push', 'No signatures to push', { peerUrl: peer.peerUrl });
    return;
  }

  const payload = JSON.stringify({
    type: 'push',
    signatures: signatures.map(s => ({
      hash: s.hash,
      hashType: s.hash_type,
      confidence: Math.min(0.95, 0.5 + (s.match_count - 1) * 0.1),
      attackType: 'unknown',
      firstSeen: s.first_seen,
      lastSeen: s.last_seen,
    })),
    timestamp: Date.now(),
  });

  const hmac = crypto.createHmac('sha256', peer.psk).update(payload).digest('hex');

  await retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FEDERATION_CONFIG.requestTimeoutMs);

      let response: Response;
      try {
        response = await fetch(`${peer.peerUrl}/federation/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-SavannaGuard-HMAC': hmac,
          },
          body: payload,
          signal: controller.signal,
        });
      } catch (error: unknown) {
        throw classifyFetchError(error, peer.peerUrl);
      } finally {
        clearTimeout(timeoutId);
      }

      const httpError = classifyHttpResponse(response.status, peer.peerUrl);
      if (httpError) throw httpError;

      if (response.ok) {
        markPeerSuccess(peer);
        logger.info('federation:push', 'Push succeeded', { peerUrl: peer.peerUrl, count: String(signatures.length) });
      }

      return response;
    },
    {
      maxRetries: FEDERATION_CONFIG.maxRetries,
      baseDelayMs: FEDERATION_CONFIG.baseRetryDelayMs,
      maxDelayMs: FEDERATION_CONFIG.maxRetryDelayMs,
      context: 'federation:push',
    },
  );
}

/**
 * Pull new signatures from a peer
 */
async function pullSignaturesFromPeer(peer: FederationPeer): Promise<PullResult> {
  const state = db.prepare(
    'SELECT last_hash, sync_version FROM federation_sync_state WHERE peer_id = ?'
  ).get(peer.peerId) as { last_hash: string; sync_version: number } | undefined;

  const payload = JSON.stringify({
    type: 'pull',
    lastHash: state?.last_hash ?? '',
    syncVersion: state?.sync_version ?? 0,
    timestamp: Date.now(),
  });

  const hmac = crypto.createHmac('sha256', peer.psk).update(payload).digest('hex');

  const result = await retryWithBackoff(
    async (): Promise<PullResult> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FEDERATION_CONFIG.requestTimeoutMs);

      let response: Response;
      try {
        response = await fetch(`${peer.peerUrl}/federation/state`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-SavannaGuard-HMAC': hmac,
          },
          body: payload,
          signal: controller.signal,
        });
      } catch (error: unknown) {
        throw classifyFetchError(error, peer.peerUrl);
      } finally {
        clearTimeout(timeoutId);
      }

      const httpError = classifyHttpResponse(response.status, peer.peerUrl);
      if (httpError) throw httpError;

      checkPayloadSize(response, peer.peerUrl);

      let data: { signatures: FederatedSignature[]; stateHash?: string; syncVersion?: number };
      try {
        data = await response.json() as typeof data;
      } catch (error: unknown) {
        throw new ParseError(peer.peerUrl, error instanceof Error ? error : undefined);
      }

      const safeSignatures = Array.isArray(data.signatures) ? data.signatures : [];

      markPeerSuccess(peer);
      logger.info('federation:pull', 'Pull succeeded', {
        peerUrl: peer.peerUrl,
        received: String(safeSignatures.length),
      });

      return {
        signatures: safeSignatures,
        stateHash: data.stateHash ?? state?.last_hash ?? '',
        syncVersion: data.syncVersion ?? state?.sync_version ?? 0,
      };
    },
    {
      maxRetries: FEDERATION_CONFIG.maxRetries,
      baseDelayMs: FEDERATION_CONFIG.baseRetryDelayMs,
      maxDelayMs: FEDERATION_CONFIG.maxRetryDelayMs,
      context: 'federation:pull',
    },
  );

  return result;
}

/**
 * Sync with a single peer (bidirectional)
 */
export async function syncWithPeer(peerUrl: string): Promise<SyncResult> {
  const peer = getPeerByUrl(peerUrl);
  if (!peer || peer.status === 'banned') {
    return { received: 0, merged: 0, skipped: 0, errors: ['Peer not found or banned'] };
  }

  // Allow syncing with offline peers (for recovery attempts)
  const errors: string[] = [];
  let received = 0;
  let merged = 0;
  let skipped = 0;

  // Pull first
  try {
    const pullResult = await pullSignaturesFromPeer(peer);
    for (const sig of pullResult.signatures) {
      received++;
      const result = recordFederatedSignature(
        sig.hash,
        sig.hashType,
        sig.attackType,
        sig.confidence,
        sig.sourcePeer,
      );
      if (result.merged) merged++;
      if (result.skipped) skipped++;
    }

    db.prepare(
      `INSERT INTO federation_sync_state (peer_id, last_sync, last_hash, sync_version)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(peer_id) DO UPDATE SET
         last_sync = excluded.last_sync,
         last_hash = excluded.last_hash,
         sync_version = excluded.sync_version`
    ).run(peer.peerId, Date.now(), pullResult.stateHash, pullResult.syncVersion);
  } catch (error: unknown) {
    const reason = error instanceof FederationError ? error.message : String(error);
    errors.push(`Pull failed: ${reason}`);
    markPeerFailure(peer, reason);
  }

  // Then push
  try {
    await pushSignaturesToPeer(peer);
  } catch (error: unknown) {
    const reason = error instanceof FederationError ? error.message : String(error);
    errors.push(`Push failed: ${reason}`);
    // Only mark failure for push if pull also failed (or didn't run)
    // Push-specific failures are logged but don't affect peer state as severely
    if (errors.length > 0) {
      // Peer already marked as failure from pull, don't double-count
    } else {
      markPeerFailure(peer, reason);
    }
  }

  logger.info('federation:sync', 'Sync completed', {
    peerUrl,
    received: String(received),
    merged: String(merged),
    skipped: String(skipped),
    errors: String(errors.length),
  });

  return { received, merged, skipped, errors };
}

/**
 * Sync with all active peers (concurrent, 5-minute cycle)
 */
export async function syncWithActivePeers(): Promise<SyncAllResult> {
  if (!FEDERATION_CONFIG.enabled) {
    return { totalPeers: 0, syncedPeers: 0, failedPeers: 0, results: [] };
  }

  const peers = listPeers().filter(p => p.status === 'active');
  return syncPeersInternal(peers);
}

/**
 * Sync with offline peers (concurrent, 30-minute cycle, for recovery)
 */
export async function syncWithOfflinePeers(): Promise<SyncAllResult> {
  if (!FEDERATION_CONFIG.enabled) {
    return { totalPeers: 0, syncedPeers: 0, failedPeers: 0, results: [] };
  }

  const peers = listPeers().filter(p => p.status === 'offline');
  if (peers.length === 0) {
    return { totalPeers: 0, syncedPeers: 0, failedPeers: 0, results: [] };
  }

  logger.info('federation:offline', 'Attempting recovery sync for offline peers', {
    count: String(peers.length),
  });

  return syncPeersInternal(peers);
}

/**
 * Sync with all configured peers (backwards-compatible alias)
 */
export async function syncWithAllPeers(): Promise<SyncAllResult> {
  return syncWithActivePeers();
}

/**
 * Internal: sync a set of peers concurrently via Promise.allSettled
 */
async function syncPeersInternal(peers: FederationPeer[]): Promise<SyncAllResult> {
  const results = await Promise.allSettled(
    peers.map(async (peer) => {
      const result = await syncWithPeer(peer.peerUrl);
      return { peerUrl: peer.peerUrl, ...result };
    }),
  );

  const finalResults: Array<{ peerUrl: string; received: number; merged: number; skipped: number; errors: string[] }> = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      finalResults.push(result.value);
    } else {
      finalResults.push({
        peerUrl: 'unknown',
        received: 0,
        merged: 0,
        skipped: 0,
        errors: [result.reason instanceof Error ? result.reason.message : String(result.reason)],
      });
    }
  }

  const syncedPeers = finalResults.filter(r => r.errors.length === 0).length;

  return {
    totalPeers: peers.length,
    syncedPeers,
    failedPeers: peers.length - syncedPeers,
    results: finalResults,
  };
}

function seedPeersFromConfig(): void {
  if (FEDERATION_CONFIG.peerUrls.length === 0) return;

  for (const peerUrl of FEDERATION_CONFIG.peerUrls) {
    const normalized = peerUrl.trim();
    if (!normalized) continue;
    if (getPeerByUrl(normalized)) continue;
    if (!FEDERATION_CONFIG.psk) continue;
    addPeer(normalized, FEDERATION_CONFIG.psk);
  }
}

/**
 * Start background sync job — two separate intervals for active and offline peers
 */
export function startBackgroundSync(): void {
  if (!FEDERATION_CONFIG.enabled) return;
  if (activeSyncInterval) return;

  seedPeersFromConfig();

  // Initial sync for active peers
  syncWithActivePeers().catch((error: unknown) => {
    logger.error('federation:sync', 'Initial active sync failed', { error: String(error) });
  });

  // Active peer sync — 5-minute cycle
  activeSyncInterval = setInterval(() => {
    syncWithActivePeers().catch((error: unknown) => {
      logger.error('federation:sync', 'Periodic active sync failed', { error: String(error) });
    });
  }, FEDERATION_CONFIG.syncIntervalMs);

  // Offline peer recovery sync — 30-minute cycle
  offlineSyncInterval = setInterval(() => {
    syncWithOfflinePeers().catch((error: unknown) => {
      logger.error('federation:offline', 'Periodic offline sync failed', { error: String(error) });
    });
  }, FEDERATION_CONFIG.offlineSyncIntervalMs);

  logger.info('federation', 'Background sync started', {
    activeIntervalMs: String(FEDERATION_CONFIG.syncIntervalMs),
    offlineIntervalMs: String(FEDERATION_CONFIG.offlineSyncIntervalMs),
  });
}

/**
 * Stop background sync job
 */
export function stopBackgroundSync(): void {
  if (activeSyncInterval) {
    clearInterval(activeSyncInterval);
    activeSyncInterval = null;
  }
  if (offlineSyncInterval) {
    clearInterval(offlineSyncInterval);
    offlineSyncInterval = null;
  }
  logger.info('federation', 'Background sync stopped');
}

/**
 * Get federation statistics
 */
export function getFederationStats(): {
  peerCount: number;
  activePeerCount: number;
  offlinePeerCount: number;
  signatureCount: number;
  avgConfidence: number;
} {
  const peers = listPeers();
  const sigStats = db.prepare(
    'SELECT COUNT(*) as count, AVG(confidence) as avg FROM federated_signatures'
  ).get() as { count: number; avg: number | null };

  return {
    peerCount: peers.length,
    activePeerCount: peers.filter(p => p.status === 'active').length,
    offlinePeerCount: peers.filter(p => p.status === 'offline').length,
    signatureCount: sigStats.count,
    avgConfidence: sigStats.avg ?? 0,
  };
}

/**
 * Get top federated signatures
 */
export function getTopFederatedSignatures(limit = 20): FederatedSignature[] {
  const rows = db.prepare(
    `SELECT hash, hash_type, attack_type, confidence, reporter_count, first_seen, last_seen, source_peer
     FROM federated_signatures
     ORDER BY reporter_count DESC, confidence DESC
     LIMIT ?`
  ).all(limit) as {
    hash: string;
    hash_type: string;
    attack_type: string;
    confidence: number;
    reporter_count: number;
    first_seen: number;
    last_seen: number;
    source_peer: string;
  }[];

  return rows.map(row => ({
    hash: row.hash,
    hashType: row.hash_type as 'ip' | 'ua' | 'combined',
    attackType: row.attack_type,
    confidence: row.confidence,
    reporterCount: row.reporter_count,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    sourcePeer: row.source_peer,
  }));
}