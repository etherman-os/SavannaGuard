import type { FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import { config } from '../config.js';

export const ADMIN_COOKIE_NAME = 'savanna_admin';
export const ADMIN_COOKIE_MAX_AGE_SECONDS = Math.floor(config.adminSessionTtlMs / 1000);

interface AdminSessionPayload {
  v: 1;
  exp: number;
  iat: number;
  nonce: string;
  passwordHash: string;
}

interface AdminSessionEnvelope {
  payload: AdminSessionPayload;
  signature: string;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf-8');
  const rightBuffer = Buffer.from(right, 'utf-8');
  const len = Math.max(leftBuffer.length, rightBuffer.length);
  const paddedLeft = Buffer.alloc(len);
  const paddedRight = Buffer.alloc(len);
  leftBuffer.copy(paddedLeft);
  rightBuffer.copy(paddedRight);
  try {
    return crypto.timingSafeEqual(paddedLeft, paddedRight) && leftBuffer.length === rightBuffer.length;
  } catch {
    return false;
  }
}

function currentPasswordHash(): string {
  return sha256(config.adminPassword);
}

function signPayload(payload: AdminSessionPayload): string {
  return crypto
    .createHmac('sha256', config.secretKey)
    .update(JSON.stringify(payload))
    .digest('base64url');
}

function encodeEnvelope(envelope: AdminSessionEnvelope): string {
  return Buffer.from(JSON.stringify(envelope), 'utf-8').toString('base64url');
}

function decodeEnvelope(token: string): AdminSessionEnvelope | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    return JSON.parse(decoded) as AdminSessionEnvelope;
  } catch {
    return null;
  }
}

export function verifyAdminPassword(password: string | null | undefined): boolean {
  if (!password) return false;
  return safeEquals(sha256(password), currentPasswordHash());
}

export function createAdminSessionCookie(now = Date.now()): string {
  const payload: AdminSessionPayload = {
    v: 1,
    iat: now,
    exp: now + config.adminSessionTtlMs,
    nonce: crypto.randomBytes(16).toString('hex'),
    passwordHash: currentPasswordHash(),
  };
  return encodeEnvelope({ payload, signature: signPayload(payload) });
}

export function verifyAdminSessionCookie(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;

  const envelope = decodeEnvelope(token);
  if (!envelope || typeof envelope !== 'object') return false;

  const { payload, signature } = envelope;
  if (!payload || typeof payload !== 'object' || typeof signature !== 'string') return false;
  if (payload.v !== 1) return false;
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || now > payload.exp) return false;
  if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > now + 60_000) return false;
  if (typeof payload.nonce !== 'string' || payload.nonce.length < 16) return false;
  if (typeof payload.passwordHash !== 'string' || !safeEquals(payload.passwordHash, currentPasswordHash())) return false;

  return safeEquals(signature, signPayload(payload));
}

export function isAdminRequest(request: FastifyRequest): boolean {
  return verifyAdminSessionCookie(request.cookies[ADMIN_COOKIE_NAME]);
}

export function requireAdminJson(request: FastifyRequest, reply: FastifyReply): boolean {
  if (isAdminRequest(request)) return true;
  reply.status(401).send({ error: 'Unauthorized' });
  return false;
}
