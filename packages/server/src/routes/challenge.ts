import type { FastifyInstance } from 'fastify';
import { createChallenge, verifyPow } from '../services/pow.js';
import { signToken } from '../services/token.js';
import { cleanupExpiredRows, db } from '../db.js';
import { checkRateLimit } from '../services/rateLimit.js';
import { calculateAllScores, calculateOverallScore, getVerdict } from '../services/scoring.js';
import { adaptScores, learnFromSession } from '../services/adaptive.js';
import { adaptPowDifficulty } from '../services/adaptivePow.js';
import { checkBotSignature, recordBotSignature, hashUserAgent } from '../services/botSignatures.js';
import { deriveObfKey, deobfuscatePayload } from '../services/obfuscation.js';
import { checkPassiveProtection, checkDcRateLimit } from '../services/passiveProtection.js';
import crypto from 'crypto';
import { config } from '../config.js';

interface MouseDataInput {
  straightLineRatio?: number;
  velocity?: number;
  maxVelocity?: number;
  directionChanges?: number;
}

interface TimingDataInput {
  timeOnPageMs?: number;
}

interface KeyboardDataInput {
  avgDwellTime?: number;
  avgFlightTime?: number;
  dwellVariance?: number;
  flightVariance?: number;
  totalKeystrokes?: number;
}

interface CanvasDataInput {
  canvasHash?: string;
  isCanvasSupported?: boolean;
  canvasBlankHash?: string;
  webglRendererFromCanvas?: string;
}

interface WebGLDataInput {
  renderer?: string;
  vendor?: string;
  hasWebGL?: boolean;
  webglExtensions?: number;
  maxTextureSize?: number;
  maxRenderbufferSize?: number;
}

interface ScreenDataInput {
  width?: number;
  height?: number;
  colorDepth?: number;
  pixelRatio?: number;
}

interface NavigatorDataInput {
  userAgent?: string;
  platform?: string;
  language?: string;
  timezone?: string;
  timezoneOffset?: number;
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
}

interface NetworkDataInput {
  latencyMs?: number;
  effectiveType?: string;
  downlink?: number;
}

interface TimingOracleDataInput {
  performanceNowMonotonic?: boolean;
  setTimeoutDriftMs?: number;
  dateNowVsPerformanceNowDriftMs?: number;
  cryptoSignTimingMs?: number;
  cryptoDeriveTimingMs?: number;
  hotFunctionTimings?: number[];
  jitPatternVariance?: number;
  polymorphicCallTimingMs?: number;
  rafLatencyVarianceMs?: number;
  rafFrameBudgetRatio?: number;
  headlessLikelihood?: number;
  detectionSignals?: string[];
}

interface TremorDataInput {
  dominantFrequencyHz?: number;
  tremorPowerRatio?: number;
  spectralEntropy?: number;
  peakToPeakJitter?: number;
  sampleCount?: number;
}

interface WebRTCOracleDataInput {
  iceCandidateCount?: number;
  localIPCount?: number;
  hasRFC1918Local?: boolean;
  hasSrflxCandidate?: boolean;
  hasRelayedCandidate?: boolean;
  hasPrflxCandidate?: boolean;
  likelyDatacenter?: boolean;
  likelyVPN?: boolean;
  networkComplexity?: number;
  collected?: boolean;
}

interface SolveRequestBody {
  challengeId: string;
  solution: string;
  sessionId: string;
  d?: string;
  mouseData?: MouseDataInput;
  timingData?: TimingDataInput;
  keyboardData?: KeyboardDataInput;
  canvasData?: CanvasDataInput;
  webglData?: WebGLDataInput;
  screenData?: ScreenDataInput;
  navigatorData?: NavigatorDataInput;
  networkData?: NetworkDataInput;
  timingOracleData?: TimingOracleDataInput | null;
  tremorData?: TremorDataInput | null;
  webrtcOracleData?: WebRTCOracleDataInput | null;
}

function hashIp(ip: string): string {
  const dayBucket = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(`${ip}:${config.secretKey}:${dayBucket}`).digest('hex');
}

export function challengeRoutes(app: FastifyInstance) {
  app.post('/api/v1/challenge/create', async (req, rep) => {
    const clientIp = req.ip ?? 'unknown';

    // Passive protection: block datacenter IPs if configured
    const passiveCheck = checkPassiveProtection(clientIp);
    if (passiveCheck.blocked) {
      return rep.status(403).send({ error: 'Access denied', reason: passiveCheck.reason });
    }

    // Stricter rate limit for datacenter IPs
    if (passiveCheck.isDatacenter) {
      const ipHash = hashIp(clientIp);
      const dcLimit = checkDcRateLimit(ipHash);
      if (!dcLimit.allowed) {
        return rep.status(429).send({
          error: 'Too many requests',
          retryAfter: Math.ceil((dcLimit.resetAt - Date.now()) / 1000),
        });
      }
    }

    cleanupExpiredRows();

    const ipHash = hashIp(clientIp);
    const rateLimit = checkRateLimit(ipHash);
    if (!rateLimit.allowed) {
      return rep.status(429).send({
        error: 'Too many requests',
        retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
      });
    }

    // Adaptive PoW: auto-adjust difficulty based on threat level
    const { difficulty: adaptiveDifficulty } = adaptPowDifficulty();

    const sessionId = crypto.randomUUID();
    const challenge = createChallenge(adaptiveDifficulty);

    db.prepare(
      'INSERT INTO challenges (id, nonce, difficulty, expires_at, session_id) VALUES (?, ?, ?, ?, ?)'
    ).run(challenge.id, challenge.nonce, challenge.difficulty, challenge.expiresAt, sessionId);

    db.prepare(
      'INSERT INTO sessions (id, created_at, ip_hash, user_agent) VALUES (?, ?, ?, ?)'
    ).run(sessionId, Date.now(), ipHash, req.headers['user-agent'] ?? '');

    const obfKey = deriveObfKey(sessionId, challenge.id);

    return {
      challengeId: challenge.id,
      nonce: challenge.nonce,
      difficulty: challenge.difficulty,
      sessionId,
      obfKey,
    };
  });

  app.post('/api/v1/challenge/solve', async (req, rep) => {
    const clientIp = req.ip ?? 'unknown';

    // Passive protection: block datacenter IPs if configured
    const passiveCheck = checkPassiveProtection(clientIp);
    if (passiveCheck.blocked) {
      return rep.status(403).send({ error: 'Access denied', reason: passiveCheck.reason });
    }

    // Stricter rate limit for datacenter IPs
    if (passiveCheck.isDatacenter) {
      const dcIpHash = hashIp(clientIp);
      const dcLimit = checkDcRateLimit(dcIpHash);
      if (!dcLimit.allowed) {
        return rep.status(429).send({
          error: 'Too many requests',
          retryAfter: Math.ceil((dcLimit.resetAt - Date.now()) / 1000),
        });
      }
    }

    const rawBody = (req.body ?? {}) as Record<string, unknown>;

    if (typeof rawBody.challengeId !== 'string' || typeof rawBody.solution !== 'string' || typeof rawBody.sessionId !== 'string') {
      return rep.status(400).send({ error: 'Invalid payload' });
    }

    const { challengeId, solution, sessionId } = rawBody as { challengeId: string; solution: string; sessionId: string };

    let body: SolveRequestBody;

    if (typeof rawBody.d === 'string' && rawBody.d.length > 0) {
      try {
        const obfKey = deriveObfKey(sessionId, challengeId);
        const json = deobfuscatePayload(rawBody.d, obfKey);
        const decoded = JSON.parse(json) as Record<string, unknown>;
        body = { challengeId, solution, sessionId, ...decoded } as SolveRequestBody;
      } catch {
        return rep.status(400).send({ error: 'Invalid payload encoding' });
      }
    } else {
      body = rawBody as unknown as SolveRequestBody;
    }

    const challengeRow = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId) as {
      id: string;
      nonce: string;
      difficulty: number;
      expires_at: number;
      session_id: string;
    } | undefined;

    if (!challengeRow) return rep.status(404).send({ error: 'Challenge not found' });
    if (challengeRow.session_id !== sessionId) return rep.status(400).send({ error: 'Session mismatch' });
    if (Date.now() > challengeRow.expires_at) return rep.status(410).send({ error: 'Challenge expired' });

    const sessionRow = db.prepare('SELECT id, ip_hash, user_agent FROM sessions WHERE id = ?').get(sessionId) as {
      id: string;
      ip_hash: string;
      user_agent: string;
    } | undefined;
    if (!sessionRow) return rep.status(404).send({ error: 'Session not found' });

    const powValid = verifyPow(challengeRow.nonce, solution, challengeRow.difficulty);
    const powScore = powValid ? 100 : 0;

    // Build behavioral data map from all signal groups
    const behavioral: Record<string, unknown> = {};
    if (body.mouseData) Object.assign(behavioral, body.mouseData);
    if (body.timingData) {
      behavioral.timeOnPage = body.timingData.timeOnPageMs;
    }
    if (body.keyboardData) Object.assign(behavioral, body.keyboardData);
    if (body.canvasData) Object.assign(behavioral, body.canvasData);
    if (body.webglData) Object.assign(behavioral, body.webglData);
    if (body.screenData) {
      behavioral.screenWidth = body.screenData.width;
      behavioral.screenHeight = body.screenData.height;
      behavioral.colorDepth = body.screenData.colorDepth;
      behavioral.pixelRatio = body.screenData.pixelRatio;
    }
    if (body.navigatorData) Object.assign(behavioral, body.navigatorData);
    if (body.networkData) {
      behavioral.latencyMs = body.networkData.latencyMs;
      behavioral.networkType = body.networkData.effectiveType;
      behavioral.networkDownlink = body.networkData.downlink;
    }
    if (body.timingOracleData) {
      behavioral.timingOracle = body.timingOracleData;
    }
    if (body.tremorData) {
      behavioral.tremor = body.tremorData;
    }
    if (body.webrtcOracleData) {
      behavioral.webrtcOracle = body.webrtcOracleData;
    }

    // 1. Rule-based signal scores
    const signalScores = calculateAllScores(behavioral);

    // 2. Adaptive ML: compare to learned site model
    const adaptive = adaptScores(signalScores);

    // 3. Bot signature check
    const uaHash = hashUserAgent(sessionRow.user_agent);
    const botCheck = checkBotSignature(sessionRow.ip_hash, uaHash);

    // 4. Calculate final score with adaptive adjustment
    let finalScore = calculateOverallScore(powScore, signalScores);

    // Apply adaptive ML penalty/bonus
    if (adaptive.confidence > 20) {
      const signalAvg = (signalScores.mouseScore + signalScores.keyboardScore + signalScores.timingScore + signalScores.canvasScore + signalScores.webglScore + signalScores.screenScore + signalScores.navigatorScore + signalScores.networkScore + signalScores.timingOracleScore + signalScores.tremorScore + signalScores.webrtcOracleScore) / 11;
      const adaptiveDiff = adaptive.adjustedScore - signalAvg;
      finalScore = Math.round(finalScore + adaptiveDiff * 0.3);
    }

    // Apply known bot penalty
    if (botCheck.isKnownBot) {
      finalScore = Math.round(finalScore * (1 - botCheck.confidence * 0.5));
    }

    // Global spoofing penalty: multiply by 0.6 when 1+ spoofing signals detected
    if (signalScores.spoofingFlags >= 1) {
      finalScore = Math.round(finalScore * 0.6);
    }

    finalScore = Math.max(0, Math.min(100, finalScore));
    const verdict = getVerdict(finalScore);

    db.prepare('DELETE FROM challenges WHERE id = ?').run(challengeId);

    const verdictToken = powValid ? signToken(sessionId, finalScore, verdict) : null;

    db.prepare(
      `UPDATE sessions SET
        mouse_score = ?, keyboard_score = ?, timing_score = ?,
        pow_score = ?, canvas_score = ?, webgl_score = ?,
        screen_score = ?, navigator_score = ?, network_score = ?,
        final_score = ?, verdict = ?, verdict_token = ?
       WHERE id = ?`
    ).run(
      signalScores.mouseScore,
      signalScores.keyboardScore,
      signalScores.timingScore,
      powScore,
      signalScores.canvasScore,
      signalScores.webglScore,
      signalScores.screenScore,
      signalScores.navigatorScore,
      signalScores.networkScore,
      finalScore,
      verdict,
      verdictToken,
      sessionId
    );

    // 5. Learn from human sessions (online learning)
    if (verdict === 'human') {
      learnFromSession(signalScores, 'human');
    }

    // 6. Record bot signatures for future detection
    if (verdict === 'bot') {
      recordBotSignature(sessionRow.ip_hash, uaHash);
    }

    return {
      success: powValid,
      token: verdictToken,
      score: finalScore,
      verdict,
      federatedSource: botCheck.source === 'federation',
    };
  });
}
