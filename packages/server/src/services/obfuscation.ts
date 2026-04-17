import crypto from 'crypto';
import { config } from '../config.js';

export function deriveObfKey(sessionId: string, challengeId: string): string {
  return crypto.createHmac('sha256', config.secretKey).update(sessionId + challengeId).digest('hex');
}

export function deobfuscatePayload(data: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const xored = Buffer.from(data, 'base64url');
  const jsonBytes = Buffer.alloc(xored.length);
  for (let i = 0; i < xored.length; i++) {
    jsonBytes[i] = xored[i] ^ key[i % key.length];
  }
  return jsonBytes.toString('utf-8');
}