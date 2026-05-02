import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';

export const MIN_POW_DIFFICULTY = 3;
export const MAX_POW_DIFFICULTY = 6;

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    difficulty INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    session_id TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    ip_hash TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    mouse_score REAL DEFAULT 0,
    keyboard_score REAL DEFAULT 0,
    timing_score REAL DEFAULT 0,
    pow_score REAL DEFAULT 0,
    canvas_score REAL DEFAULT 0,
    webgl_score REAL DEFAULT 0,
    screen_score REAL DEFAULT 0,
    navigator_score REAL DEFAULT 0,
    network_score REAL DEFAULT 0,
    timing_oracle_score REAL DEFAULT 0,
    tremor_score REAL DEFAULT 0,
    webrtc_oracle_score REAL DEFAULT 0,
    final_score REAL DEFAULT 0,
    verdict TEXT DEFAULT 'pending',
    verdict_token TEXT,
    verdict_token_used_at INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS site_signals (
    signal_key TEXT PRIMARY KEY,
    signal_name TEXT NOT NULL,
    mean_value REAL DEFAULT 0,
    count INTEGER DEFAULT 0,
    stddev REAL DEFAULT 0,
    last_updated INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bot_signatures (
    hash TEXT NOT NULL,
    hash_type TEXT NOT NULL,
    match_count INTEGER DEFAULT 1,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    source TEXT DEFAULT 'auto',
    PRIMARY KEY (hash, hash_type)
  );

  CREATE TABLE IF NOT EXISTS federation_peers (
    peer_id TEXT PRIMARY KEY,
    peer_url TEXT NOT NULL,
    psk TEXT NOT NULL,
    last_seen INTEGER NOT NULL,
    trusted INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS federated_signatures (
    hash TEXT NOT NULL,
    hash_type TEXT NOT NULL,
    attack_type TEXT DEFAULT 'unknown',
    confidence REAL NOT NULL,
    reporter_count INTEGER DEFAULT 1,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    source_peer TEXT NOT NULL,
    PRIMARY KEY (hash, hash_type)
  );

  CREATE TABLE IF NOT EXISTS federated_signature_reports (
    hash TEXT NOT NULL,
    hash_type TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    reported_at INTEGER NOT NULL,
    PRIMARY KEY (hash, hash_type, peer_id)
  );

  CREATE TABLE IF NOT EXISTS federation_sync_state (
    peer_id TEXT PRIMARY KEY,
    last_sync INTEGER NOT NULL,
    last_hash TEXT NOT NULL,
    sync_version INTEGER DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_created
    ON sessions(created_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_verdict
    ON sessions(verdict);
  CREATE INDEX IF NOT EXISTS idx_bot_sigs_last_seen
    ON bot_signatures(last_seen);
  CREATE INDEX IF NOT EXISTS idx_federated_sigs_last_seen
    ON federated_signatures(last_seen);
  CREATE INDEX IF NOT EXISTS idx_federated_sigs_confidence
    ON federated_signatures(confidence);
  CREATE INDEX IF NOT EXISTS idx_fed_sig_reports_peer
    ON federated_signature_reports(peer_id);
`);

db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('pow_difficulty', '4')").run();
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('adaptive_pow_enabled', 'true')").run();

function safeAddColumn(table: string, column: string, type: string, defaultValue: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type} NOT NULL DEFAULT ${defaultValue}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('duplicate column name')) {
      return;
    }
    throw err;
  }
}

safeAddColumn('federation_peers', 'consecutive_failures', 'INTEGER', '0');
safeAddColumn('federation_peers', 'last_failure_at', 'INTEGER', '0');
safeAddColumn('federation_peers', 'last_failure_reason', 'TEXT', "''");
safeAddColumn('federation_peers', 'last_success_at', 'INTEGER', '0');

function normalizePeerUrlForStorage(peerUrl: string): string {
  const trimmed = peerUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${normalizedPath}`;
  } catch {
    return trimmed;
  }
}

function dedupeFederationPeersByUrl(): void {
  const rows = db.prepare(
    `SELECT peer_id, peer_url, last_seen, last_success_at
     FROM federation_peers
     ORDER BY last_success_at DESC, last_seen DESC, rowid DESC`
  ).all() as Array<{ peer_id: string; peer_url: string; last_seen: number; last_success_at: number }>;

  const seenUrls = new Set<string>();
  const duplicatePeerIds: string[] = [];

  const updateUrl = db.prepare('UPDATE federation_peers SET peer_url = ? WHERE peer_id = ?');

  for (const row of rows) {
    const normalizedUrl = normalizePeerUrlForStorage(row.peer_url);

    if (row.peer_url !== normalizedUrl) {
      updateUrl.run(normalizedUrl, row.peer_id);
    }

    if (seenUrls.has(normalizedUrl)) {
      duplicatePeerIds.push(row.peer_id);
      continue;
    }

    seenUrls.add(normalizedUrl);
  }

  if (duplicatePeerIds.length === 0) return;

  const removeDuplicates = db.transaction((peerIds: string[]) => {
    const deletePeer = db.prepare('DELETE FROM federation_peers WHERE peer_id = ?');
    const deleteSyncState = db.prepare('DELETE FROM federation_sync_state WHERE peer_id = ?');
    for (const peerId of peerIds) {
      deletePeer.run(peerId);
      deleteSyncState.run(peerId);
    }
  });

  removeDuplicates(duplicatePeerIds);
}

dedupeFederationPeersByUrl();
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_federation_peers_peer_url ON federation_peers(peer_url)');

// Migration: add timing_oracle, tremor, and webrtc_oracle score columns
safeAddColumn('sessions', 'timing_oracle_score', 'REAL', '0');
safeAddColumn('sessions', 'tremor_score', 'REAL', '0');
safeAddColumn('sessions', 'webrtc_oracle_score', 'REAL', '0');
safeAddColumn('sessions', 'verdict_token_used_at', 'INTEGER', '0');

export interface DbChallenge {
  id: string;
  nonce: string;
  difficulty: number;
  expires_at: number;
  session_id: string;
}

export interface DbSession {
  id: string;
  created_at: number;
  mouse_score: number;
  keyboard_score: number;
  timing_score: number;
  pow_score: number;
  canvas_score: number;
  webgl_score: number;
  screen_score: number;
  navigator_score: number;
  network_score: number;
  timing_oracle_score: number;
  tremor_score: number;
  webrtc_oracle_score: number;
  final_score: number;
  verdict: string;
  verdict_token: string | null;
  verdict_token_used_at: number;
  ip_hash: string;
  user_agent: string;
}

function clampDifficulty(value: number): number {
  return Math.max(MIN_POW_DIFFICULTY, Math.min(MAX_POW_DIFFICULTY, value));
}

export function getPowDifficulty(): number {
  const row = db.prepare("SELECT value FROM settings WHERE key='pow_difficulty'").get() as { value: string } | undefined;
  const parsed = Number.parseInt(row?.value ?? '4', 10);
  if (!Number.isFinite(parsed)) return 4;
  return clampDifficulty(parsed);
}

export function setPowDifficulty(nextDifficulty: number): number {
  const clamped = clampDifficulty(nextDifficulty);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'pow_difficulty'").run(String(clamped));
  return clamped;
}

export function getAdaptivePowEnabled(): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key='adaptive_pow_enabled'").get() as { value: string } | undefined;
  if (!row) return true;
  return row.value !== 'false';
}

export function setAdaptivePowEnabled(enabled: boolean): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('adaptive_pow_enabled', ?)").run(enabled ? 'true' : 'false');
}

// Read blockDatacenterIPs from settings table; falls back to env config
export function getBlockDatacenterIPs(): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key='blockDatacenterIPs'").get() as { value: string } | undefined;
  if (!row) return config.passiveProtection.blockDatacenterIPs;
  return row.value === 'true';
}

export function setBlockDatacenterIPs(enabled: boolean): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('blockDatacenterIPs', ?)").run(enabled ? 'true' : 'false');
}

export function isDbHealthy(): boolean {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

export function cleanupExpiredRows(now = Date.now()): void {
  const sessionRetentionMs = 30 * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM challenges WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(now - sessionRetentionMs);
}
