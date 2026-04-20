import { config } from '../config.js';
import { isDatacenterIP, getDatacenterRangeCount } from './datacenterRanges.js';
import { getBlockDatacenterIPs } from '../db.js';

interface DcRateLimitEntry {
  count: number;
  resetAt: number;
}

const dcRateLimitMap = new Map<string, DcRateLimitEntry>();

let dcDetectionsLast24h = 0;
let dcThrottledLast24h = 0;
let lastDcStatsReset = Date.now();

function resetDcStatsIfNeeded(): void {
  const now = Date.now();
  if (now - lastDcStatsReset > 24 * 60 * 60 * 1000) {
    dcDetectionsLast24h = 0;
    dcThrottledLast24h = 0;
    lastDcStatsReset = now;
  }
}

export interface PassiveProtectionResult {
  blocked: boolean;
  isDatacenter: boolean;
  reason?: string;
}

export interface DcRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkPassiveProtection(ip: string): PassiveProtectionResult {
  if (!config.passiveProtection.enabled) {
    return { blocked: false, isDatacenter: false };
  }

  const dcCheck = isDatacenterIP(ip, config.passiveProtection.customBlockRanges);

  if (dcCheck) {
    resetDcStatsIfNeeded();
    dcDetectionsLast24h++;

    if (getBlockDatacenterIPs()) {
      return { blocked: true, isDatacenter: true, reason: 'datacenter_ip' };
    }
  }

  return { blocked: false, isDatacenter: dcCheck };
}

export function checkDcRateLimit(ipHash: string): DcRateLimitResult {
  const maxPerMinute = config.passiveProtection.datacenterRateLimitMax;
  const windowMs = 60 * 1000;
  const now = Date.now();

  const entry = dcRateLimitMap.get(ipHash);

  if (!entry || now > entry.resetAt) {
    dcRateLimitMap.set(ipHash, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      allowed: true,
      remaining: maxPerMinute - 1,
      resetAt: now + windowMs,
    };
  }

  if (entry.count >= maxPerMinute) {
    resetDcStatsIfNeeded();
    dcThrottledLast24h++;
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: maxPerMinute - entry.count,
    resetAt: entry.resetAt,
  };
}

export function cleanupDcRateLimits(): void {
  const now = Date.now();
  for (const [key, entry] of dcRateLimitMap.entries()) {
    if (now > entry.resetAt) {
      dcRateLimitMap.delete(key);
    }
  }
}

export interface PassiveProtectionStats {
  enabled: boolean;
  blockDatacenterIPs: boolean;
  datacenterRangesCount: number;
  customRangesCount: number;
  datacenterRateLimitMax: number;
  dcDetectionsLast24h: number;
  dcThrottledLast24h: number;
}

export function getPassiveProtectionStats(): PassiveProtectionStats {
  resetDcStatsIfNeeded();
  return {
    enabled: config.passiveProtection.enabled,
    blockDatacenterIPs: getBlockDatacenterIPs(),
    datacenterRangesCount: getDatacenterRangeCount(config.passiveProtection.customBlockRanges),
    customRangesCount: config.passiveProtection.customBlockRanges.length,
    datacenterRateLimitMax: config.passiveProtection.datacenterRateLimitMax,
    dcDetectionsLast24h,
    dcThrottledLast24h,
  };
}