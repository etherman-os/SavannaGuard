import crypto from 'crypto';
import { db } from '../db.js';

const SIGNATURE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const BOT_MATCH_THRESHOLD = 3;

export function hashUserAgent(userAgent: string): string {
  return crypto.createHash('sha256').update(`ua:${userAgent}`).digest('hex').substring(0, 16);
}

export function checkBotSignature(ipHash: string, uaHash: string): { isKnownBot: boolean; confidence: number } {
  const ipMatch = db.prepare(
    'SELECT match_count FROM bot_signatures WHERE hash = ? AND hash_type = ?'
  ).get(ipHash, 'ip') as { match_count: number } | undefined;

  const uaMatch = db.prepare(
    'SELECT match_count FROM bot_signatures WHERE hash = ? AND hash_type = ?'
  ).get(uaHash, 'ua') as { match_count: number } | undefined;

  const ipHits = ipMatch?.match_count ?? 0;
  const uaHits = uaMatch?.match_count ?? 0;

  if (ipHits >= BOT_MATCH_THRESHOLD && uaHits >= BOT_MATCH_THRESHOLD) {
    return { isKnownBot: true, confidence: 0.95 };
  }

  if (ipHits >= BOT_MATCH_THRESHOLD) {
    return { isKnownBot: true, confidence: 0.7 };
  }

  if (uaHits >= BOT_MATCH_THRESHOLD) {
    return { isKnownBot: true, confidence: 0.6 };
  }

  return { isKnownBot: false, confidence: 0 };
}

export function recordBotSignature(ipHash: string, uaHash: string): void {
  const now = Date.now();

  db.prepare(
    `INSERT INTO bot_signatures (hash, hash_type, match_count, first_seen, last_seen, source)
     VALUES (?, ?, 1, ?, ?, 'auto')
     ON CONFLICT(hash, hash_type) DO UPDATE SET
       match_count = match_count + 1,
       last_seen = ?`
  ).run(ipHash, 'ip', now, now, now);

  db.prepare(
    `INSERT INTO bot_signatures (hash, hash_type, match_count, first_seen, last_seen, source)
     VALUES (?, ?, 1, ?, ?, 'auto')
     ON CONFLICT(hash, hash_type) DO UPDATE SET
       match_count = match_count + 1,
       last_seen = ?`
  ).run(uaHash, 'ua', now, now, now);
}

export function cleanupOldSignatures(): void {
  const cutoff = Date.now() - SIGNATURE_RETENTION_MS;
  db.prepare('DELETE FROM bot_signatures WHERE last_seen < ?').run(cutoff);
}

export function getBotSignatureStats(): {
  total: number;
  ipSignatures: number;
  uaSignatures: number;
  topHits: Array<{ hash: string; type: string; count: number }>;
} {
  const total = (db.prepare('SELECT COUNT(*) as c FROM bot_signatures').get() as { c: number }).c;
  const ipSigs = (db.prepare("SELECT COUNT(*) as c FROM bot_signatures WHERE hash_type = 'ip'").get() as { c: number }).c;
  const uaSigs = (db.prepare("SELECT COUNT(*) as c FROM bot_signatures WHERE hash_type = 'ua'").get() as { c: number }).c;

  const topHits = db.prepare(
    'SELECT hash, hash_type as type, match_count as count FROM bot_signatures ORDER BY match_count DESC LIMIT 10'
  ).all() as Array<{ hash: string; type: string; count: number }>;

  return { total, ipSignatures: ipSigs, uaSignatures: uaSigs, topHits };
}
