import { db, setPowDifficulty, getPowDifficulty } from '../db.js';

interface ThreatSnapshot {
  botRatio: number;
  totalSessions: number;
  botCount: number;
}

function getRecentThreatSnapshot(): ThreatSnapshot {
  const windowMs = 10 * 60 * 1000; // last 10 minutes
  const since = Date.now() - windowMs;

  const total = (db.prepare('SELECT COUNT(*) as c FROM sessions WHERE created_at >= ?').get(since) as { c: number }).c;
  const bots = (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE created_at >= ? AND verdict IN ('bot', 'suspicious')").get(since) as { c: number }).c;

  return {
    botRatio: total > 5 ? bots / total : 0,
    totalSessions: total,
    botCount: bots,
  };
}

export function adaptPowDifficulty(): { difficulty: number; reason: string; threat: ThreatSnapshot } {
  const snapshot = getRecentThreatSnapshot();
  const current = getPowDifficulty();

  if (snapshot.totalSessions < 10) {
    return { difficulty: current, reason: 'Not enough data', threat: snapshot };
  }

  let target = current;

  if (snapshot.botRatio > 0.6) {
    target = Math.min(6, current + 2);
  } else if (snapshot.botRatio > 0.4) {
    target = Math.min(6, current + 1);
  } else if (snapshot.botRatio < 0.1 && snapshot.totalSessions > 50) {
    target = Math.max(1, current - 1);
  } else if (snapshot.botRatio < 0.2 && snapshot.totalSessions > 100) {
    target = Math.max(2, current - 1);
  }

  if (target !== current) {
    setPowDifficulty(target);
  }

  const reason = target > current ? 'Threat level HIGH - increasing difficulty'
    : target < current ? 'Threat level LOW - decreasing difficulty'
    : 'Threat level NORMAL - maintaining difficulty';

  return { difficulty: target, reason, threat: snapshot };
}

export function getThreatStatus(): { botRatio: number; difficulty: number; totalSessions: number; botCount: number } {
  const snapshot = getRecentThreatSnapshot();
  return {
    botRatio: Math.round(snapshot.botRatio * 100),
    difficulty: getPowDifficulty(),
    totalSessions: snapshot.totalSessions,
    botCount: snapshot.botCount,
  };
}
