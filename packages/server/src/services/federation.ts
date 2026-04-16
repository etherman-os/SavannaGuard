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
 */

import { db } from '../db.js';
import crypto from 'crypto';
import { config } from '../config.js';

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
}

export interface FederationPeerPublic {
  peerId: string;
  peerUrl: string;
  lastSeen: number;
  trusted: boolean;
  status: 'active' | 'offline' | 'banned';
}

export interface FederatedResult {
  isKnownBot: boolean;
  confidence: number;
  source: 'federation';
  attackType?: string;
}

export interface SyncResult {
  received: number;
  merged: number;
  errors: string[];
}

export interface SyncAllResult {
  totalPeers: number;
  syncedPeers: number;
  failedPeers: number;
  results: Array<{ peerUrl: string; received: number; merged: number; errors: string[] }>;
}

interface PullResult {
  signatures: FederatedSignature[];
  stateHash: string;
  syncVersion: number;
}

// Configuration
const FEDERATION_CONFIG = {
  enabled: config.federation.enabled,
  peerUrls: config.federation.peerUrls,
  syncIntervalMs: Number.isFinite(config.federation.syncIntervalMs) ? Math.max(1000, config.federation.syncIntervalMs) : 300000,
  minConfidence: Number.isFinite(config.federation.minConfidence) ? Math.max(0, Math.min(1, config.federation.minConfidence)) : 0.7,
  minReporters: Number.isFinite(config.federation.minReporters) ? Math.max(1, config.federation.minReporters) : 2,
  psk: config.federation.psk,
};

let syncInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Add a new peer to the trusted peer list
 */
export function addPeer(peerUrl: string, psk: string): FederationPeer {
  const peerId = crypto.randomUUID();
  const now = Date.now();

  db.prepare(
    'INSERT INTO federation_peers (peer_id, peer_url, psk, last_seen, trusted, status) VALUES (?, ?, ?, ?, 1, ?)'
  ).run(peerId, peerUrl, psk, now, 'active');

  return {
    peerId,
    peerUrl,
    psk,
    lastSeen: now,
    trusted: true,
    status: 'active',
  };
}

/**
 * Remove a peer from the trusted peer list
 */
export function removePeer(peerId: string): void {
  db.prepare('DELETE FROM federation_peers WHERE peer_id = ?').run(peerId);
  db.prepare('DELETE FROM federation_sync_state WHERE peer_id = ?').run(peerId);
}

/**
 * List all configured peers
 */
export function listPeers(): FederationPeer[] {
  const rows = db.prepare('SELECT * FROM federation_peers').all() as {
    peer_id: string;
    peer_url: string;
    psk: string;
    last_seen: number;
    trusted: number;
    status: string;
  }[];

  return rows.map(row => ({
    peerId: row.peer_id,
    peerUrl: row.peer_url,
    psk: row.psk,
    lastSeen: row.last_seen,
    trusted: row.trusted === 1,
    status: row.status as 'active' | 'offline' | 'banned',
  }));
}

export function toPublicPeer(peer: FederationPeer): FederationPeerPublic {
  return {
    peerId: peer.peerId,
    peerUrl: peer.peerUrl,
    lastSeen: peer.lastSeen,
    trusted: peer.trusted,
    status: peer.status,
  };
}

export function listPublicPeers(): FederationPeerPublic[] {
  return listPeers().map(toPublicPeer);
}

/**
 * Get peer by URL
 */
export function getPeerByUrl(peerUrl: string): FederationPeer | null {
  const row = db.prepare('SELECT * FROM federation_peers WHERE peer_url = ?').get(peerUrl) as {
    peer_id: string;
    peer_url: string;
    psk: string;
    last_seen: number;
    trusted: number;
    status: string;
  } | undefined;

  if (!row) return null;

  return {
    peerId: row.peer_id,
    peerUrl: row.peer_url,
    psk: row.psk,
    lastSeen: row.last_seen,
    trusted: row.trusted === 1,
    status: row.status as 'active' | 'offline' | 'banned',
  };
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

  // Only trust if we have enough reporters and confidence
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
 * Record a signature received from federation (from another peer)
 */
export function recordFederatedSignature(
  hash: string,
  hashType: string,
  attackType: string,
  confidence: number,
  sourcePeer: string
): void {
  const now = Date.now();

  // Upsert base signature first. reporter_count is maintained from distinct peer reports.
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
       last_seen = excluded.last_seen`
  ).run(hash, hashType, attackType, confidence, now, now, sourcePeer);

  // Count each reporter peer only once for a given signature.
  const reportInsert = db.prepare(
    `INSERT INTO federated_signature_reports (hash, hash_type, peer_id, reported_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(hash, hash_type, peer_id) DO NOTHING`
  ).run(hash, hashType, sourcePeer, now);

  if (reportInsert.changes > 0) {
    db.prepare(
      `UPDATE federated_signatures
       SET reporter_count = reporter_count + 1,
           last_seen = ?
       WHERE hash = ? AND hash_type = ?`
    ).run(now, hash, hashType);
  }
}

/**
 * Push our new signatures to a peer
 */
async function pushSignaturesToPeer(peer: FederationPeer): Promise<void> {
  // Get signatures we've seen in the last hour that haven't been shared
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

  if (signatures.length === 0) return;

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

  try {
    const response = await fetch(`${peer.peerUrl}/federation/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SavannaGuard-HMAC': hmac,
      },
      body: payload,
    });

    if (response.ok) {
      db.prepare('UPDATE federation_peers SET last_seen = ? WHERE peer_id = ?')
        .run(Date.now(), peer.peerId);
    }
  } catch (error) {
    console.error(`Failed to push to peer ${peer.peerUrl}:`, error);
  }
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

  try {
    const response = await fetch(`${peer.peerUrl}/federation/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SavannaGuard-HMAC': hmac,
      },
      body: payload,
    });

    if (!response.ok) {
      return {
        signatures: [],
        stateHash: state?.last_hash ?? '',
        syncVersion: state?.sync_version ?? 0,
      };
    }

    const data = await response.json() as {
      signatures: FederatedSignature[];
      stateHash?: string;
      syncVersion?: number;
    };

    return {
      signatures: data.signatures ?? [],
      stateHash: data.stateHash ?? state?.last_hash ?? '',
      syncVersion: data.syncVersion ?? state?.sync_version ?? 0,
    };
  } catch (error) {
    console.error(`Failed to pull from peer ${peer.peerUrl}:`, error);
    return {
      signatures: [],
      stateHash: state?.last_hash ?? '',
      syncVersion: state?.sync_version ?? 0,
    };
  }
}

/**
 * Sync with a single peer (bidirectional)
 */
export async function syncWithPeer(peerUrl: string): Promise<SyncResult> {
  const peer = getPeerByUrl(peerUrl);
  if (!peer || peer.status !== 'active') {
    return { received: 0, merged: 0, errors: ['Peer not found or inactive'] };
  }

  const errors: string[] = [];
  let received = 0;
  let merged = 0;

  // Pull first
  try {
    const pullResult = await pullSignaturesFromPeer(peer);
    for (const sig of pullResult.signatures) {
      received++;
      recordFederatedSignature(
        sig.hash,
        sig.hashType,
        sig.attackType,
        sig.confidence,
        sig.sourcePeer
      );
      merged++;
    }

    db.prepare(
      `INSERT INTO federation_sync_state (peer_id, last_sync, last_hash, sync_version)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(peer_id) DO UPDATE SET
         last_sync = excluded.last_sync,
         last_hash = excluded.last_hash,
         sync_version = excluded.sync_version`
    ).run(peer.peerId, Date.now(), pullResult.stateHash, pullResult.syncVersion);
  } catch (error) {
    errors.push(`Pull failed: ${error}`);
  }

  // Then push
  try {
    await pushSignaturesToPeer(peer);
  } catch (error) {
    errors.push(`Push failed: ${error}`);
  }

  return { received, merged, errors };
}

/**
 * Sync with all configured peers
 */
export async function syncWithAllPeers(): Promise<SyncAllResult> {
  if (!FEDERATION_CONFIG.enabled) {
    return {
      totalPeers: 0,
      syncedPeers: 0,
      failedPeers: 0,
      results: [],
    };
  }

  const peers = listPeers().filter(p => p.status === 'active');
  const results: Array<{ peerUrl: string; received: number; merged: number; errors: string[] }> = [];

  for (const peer of peers) {
    const result = await syncWithPeer(peer.peerUrl);
    results.push({
      peerUrl: peer.peerUrl,
      received: result.received,
      merged: result.merged,
      errors: result.errors,
    });
  }

  const syncedPeers = results.filter(result => result.errors.length === 0).length;

  return {
    totalPeers: peers.length,
    syncedPeers,
    failedPeers: peers.length - syncedPeers,
    results,
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
 * Start background sync job
 */
export function startBackgroundSync(): void {
  if (!FEDERATION_CONFIG.enabled) return;
  if (syncInterval) return; // Already running

  seedPeersFromConfig();

  // Initial sync
  syncWithAllPeers().catch(console.error);

  // Periodic sync
  syncInterval = setInterval(() => {
    syncWithAllPeers().catch(console.error);
  }, FEDERATION_CONFIG.syncIntervalMs);
}

/**
 * Stop background sync job
 */
export function stopBackgroundSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/**
 * Get federation statistics
 */
export function getFederationStats(): {
  peerCount: number;
  activePeerCount: number;
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
