import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';

const MIN_POW_DIFFICULTY = 1;
const MAX_POW_DIFFICULTY = 6;

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    difficulty INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    mouse_score REAL DEFAULT 0,
    keyboard_score REAL DEFAULT 0,
    timing_score REAL DEFAULT 0,
    pow_score REAL DEFAULT 0,
    final_score REAL DEFAULT 0,
    verdict TEXT DEFAULT 'pending',
    verdict_token TEXT,
    ip_hash TEXT NOT NULL,
    user_agent TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const challengeColumns = db.prepare('PRAGMA table_info(challenges)').all() as { name: string }[];
if (!challengeColumns.some((column) => column.name === 'session_id')) {
  db.exec("ALTER TABLE challenges ADD COLUMN session_id TEXT NOT NULL DEFAULT ''");
}

db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('pow_difficulty', '4')").run();

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
  final_score: number;
  verdict: string;
  verdict_token: string | null;
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

export function cleanupExpiredRows(now = Date.now()): void {
  const sessionRetentionMs = 30 * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM challenges WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(now - sessionRetentionMs);
}
