import crypto from 'crypto';
import { config } from '../config.js';

interface TokenPayload {
  sessionId: string;
  score: number;
  verdict: string;
  expiresAt: number;
}

interface SignedTokenEnvelope {
  payload: TokenPayload;
  signature: string;
}

function base64urlEncode(data: string): string {
  return Buffer.from(data, 'utf-8').toString('base64url');
}

function base64urlDecode(data: string): string | null {
  try {
    return Buffer.from(data, 'base64url').toString('utf-8');
  } catch {
    return null;
  }
}

function invalidResult(): { valid: boolean; sessionId: string; score: number; verdict: string } {
  return { valid: false, sessionId: '', score: 0, verdict: '' };
}

function signPayload(payload: TokenPayload): string {
  const serializedPayload = JSON.stringify(payload);
  return crypto.createHmac('sha256', config.secretKey).update(serializedPayload).digest('base64url');
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf-8');
  const rightBuffer = Buffer.from(right, 'utf-8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function signToken(sessionId: string, score: number, verdict: string): string {
  const payload: TokenPayload = {
    sessionId,
    score,
    verdict,
    expiresAt: Date.now() + config.tokenTtlMs,
  };
  const signature = signPayload(payload);
  const envelope: SignedTokenEnvelope = { payload, signature };
  return base64urlEncode(JSON.stringify(envelope));
}

export function verifyToken(token: string): { valid: boolean; sessionId: string; score: number; verdict: string } {
  const decoded = base64urlDecode(token);
  if (!decoded) return invalidResult();

  let envelope: SignedTokenEnvelope;
  try {
    envelope = JSON.parse(decoded) as SignedTokenEnvelope;
  } catch {
    return invalidResult();
  }

  if (!envelope || typeof envelope !== 'object') return invalidResult();

  const payload = envelope.payload;
  const signature = envelope.signature;

  if (!payload || typeof payload !== 'object') return invalidResult();
  if (typeof payload.sessionId !== 'string' || payload.sessionId.length === 0) return invalidResult();
  if (typeof payload.verdict !== 'string' || payload.verdict.length === 0) return invalidResult();
  if (typeof payload.score !== 'number' || !Number.isFinite(payload.score)) return invalidResult();
  if (typeof payload.expiresAt !== 'number' || !Number.isFinite(payload.expiresAt)) return invalidResult();
  if (typeof signature !== 'string' || signature.length === 0) return invalidResult();

  if (Date.now() > payload.expiresAt) return invalidResult();

  const expectedSignature = signPayload(payload);
  if (!safeEquals(signature, expectedSignature)) return invalidResult();

  return {
    valid: true,
    sessionId: payload.sessionId,
    score: payload.score,
    verdict: payload.verdict,
  };
}