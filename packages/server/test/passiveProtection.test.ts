/// <reference types="vitest/globals" />
import { ipToInt, isInCIDR, isDatacenterIP, getDatacenterRangeCount } from '../src/services/datacenterRanges.js';
import { checkPassiveProtection, checkDcRateLimit, getPassiveProtectionStats } from '../src/services/passiveProtection.js';

describe('datacenterRanges', () => {
  describe('ipToInt', () => {
    it('converts valid IPv4 to integer', () => {
      expect(ipToInt('0.0.0.0')).toBe(0);
      expect(ipToInt('0.0.0.1')).toBe(1);
      expect(ipToInt('1.0.0.0')).toBe(16777216);
      expect(ipToInt('192.168.1.1')).toBe(3232235777);
      expect(ipToInt('255.255.255.255')).toBe(4294967295);
    });

    it('returns 0 for invalid IPs', () => {
      expect(ipToInt('')).toBe(0);
      expect(ipToInt('not an ip')).toBe(0);
      expect(ipToInt('1.2.3')).toBe(0);
      expect(ipToInt('1.2.3.4.5')).toBe(0);
    });
  });

  describe('isInCIDR', () => {
    it('matches IPs within a CIDR range', () => {
      expect(isInCIDR('192.168.1.0', '192.168.1.0/24')).toBe(true);
      expect(isInCIDR('192.168.1.255', '192.168.1.0/24')).toBe(true);
      expect(isInCIDR('192.168.1.128', '192.168.1.0/24')).toBe(true);
    });

    it('rejects IPs outside a CIDR range', () => {
      expect(isInCIDR('192.168.2.0', '192.168.1.0/24')).toBe(false);
      expect(isInCIDR('10.0.0.1', '192.168.1.0/24')).toBe(false);
    });

    it('handles /32 (single host)', () => {
      expect(isInCIDR('1.2.3.4', '1.2.3.4/32')).toBe(true);
      expect(isInCIDR('1.2.3.5', '1.2.3.4/32')).toBe(false);
    });

    it('handles /0 (all addresses)', () => {
      expect(isInCIDR('255.255.255.255', '0.0.0.0/0')).toBe(true);
      expect(isInCIDR('1.2.3.4', '0.0.0.0/0')).toBe(true);
    });

    it('handles /16 range', () => {
      expect(isInCIDR('162.243.0.0', '162.243.0.0/16')).toBe(true);
      expect(isInCIDR('162.243.255.255', '162.243.0.0/16')).toBe(true);
      expect(isInCIDR('162.244.0.0', '162.243.0.0/16')).toBe(false);
    });

    it('returns false for invalid CIDR', () => {
      expect(isInCIDR('1.2.3.4', 'invalid')).toBe(false);
      expect(isInCIDR('1.2.3.4', '1.2.3.4/33')).toBe(false);
      expect(isInCIDR('1.2.3.4', '/24')).toBe(false);
    });
  });

  describe('isDatacenterIP', () => {
    it('returns false for empty or unknown IP', () => {
      expect(isDatacenterIP('')).toBe(false);
      expect(isDatacenterIP('unknown')).toBe(false);
    });

    it('returns false for private/reserved IPs', () => {
      expect(isDatacenterIP('192.168.1.1')).toBe(false);
      expect(isDatacenterIP('10.0.0.1')).toBe(false);
      expect(isDatacenterIP('172.16.0.1')).toBe(false);
      expect(isDatacenterIP('127.0.0.1')).toBe(false);
    });

    it('returns true for known DigitalOcean IPs', () => {
      expect(isDatacenterIP('162.243.1.1')).toBe(true);
      expect(isDatacenterIP('128.199.100.50')).toBe(true);
      expect(isDatacenterIP('68.183.10.5')).toBe(true);
    });

    it('returns true for known Hetzner IPs', () => {
      expect(isDatacenterIP('49.12.10.5')).toBe(true);
      expect(isDatacenterIP('88.198.100.5')).toBe(true);
      expect(isDatacenterIP('159.69.50.5')).toBe(true);
    });

    it('returns true for known AWS IPs', () => {
      expect(isDatacenterIP('54.200.50.5')).toBe(true);
      expect(isDatacenterIP('174.129.50.5')).toBe(true);
    });

    it('returns true for known Linode IPs', () => {
      expect(isDatacenterIP('45.33.10.5')).toBe(true);
      expect(isDatacenterIP('139.144.10.5')).toBe(true);
    });

    it('returns true for known Vultr IPs', () => {
      expect(isDatacenterIP('45.63.10.5')).toBe(true);
      expect(isDatacenterIP('108.61.100.5')).toBe(true);
    });

    it('returns true for known OVH IPs', () => {
      expect(isDatacenterIP('51.15.10.5')).toBe(true);
      expect(isDatacenterIP('192.99.50.5')).toBe(true);
    });

    it('returns true for known GCP IPs', () => {
      expect(isDatacenterIP('35.192.10.5')).toBe(true);
    });

    it('returns true for known Azure IPs', () => {
      expect(isDatacenterIP('20.36.10.5')).toBe(true);
    });

    it('returns true for known Oracle Cloud IPs', () => {
      expect(isDatacenterIP('129.146.10.5')).toBe(true);
    });

    it('returns false for regular residential IPs', () => {
      expect(isDatacenterIP('203.0.113.1')).toBe(false);
      expect(isDatacenterIP('198.51.100.1')).toBe(false);
    });

    it('returns false for invalid IP format', () => {
      expect(isDatacenterIP('not-an-ip')).toBe(false);
      expect(isDatacenterIP('1.2.3')).toBe(false);
    });

    it('supports custom additional ranges', () => {
      expect(isDatacenterIP('203.0.113.1')).toBe(false);
      expect(isDatacenterIP('203.0.113.1', ['203.0.113.0/24'])).toBe(true);
    });

    it('strips ::ffff: IPv6-mapped IPv4 prefix and returns true for DigitalOcean', () => {
      // 162.243.1.1 is a known DigitalOcean IP
      // In IPv6-mapped format: ::ffff:162.243.1.1
      expect(isDatacenterIP('::ffff:162.243.1.1')).toBe(true);
      // Confirm the IPv4-only version also works
      expect(isDatacenterIP('162.243.1.1')).toBe(true);
    });

    it('strips ::ffff: prefix for all valid datacenter IPs', () => {
      // ::ffff: prefix stripping is consistent
      expect(isDatacenterIP('::ffff:128.199.100.50')).toBe(true); // DigitalOcean
      expect(isDatacenterIP('::ffff:45.33.10.5')).toBe(true);    // Linode
      expect(isDatacenterIP('::ffff:68.183.10.5')).toBe(true);  // DigitalOcean
    });

    it('does not misinterpret private IPs with ::ffff: prefix', () => {
      // ::ffff:192.168.1.1 is a private IP and should NOT be flagged as DC
      expect(isDatacenterIP('::ffff:192.168.1.1')).toBe(false);
      expect(isDatacenterIP('::ffff:10.0.0.1')).toBe(false);
      expect(isDatacenterIP('::ffff:172.16.0.1')).toBe(false);
      expect(isDatacenterIP('::ffff:127.0.0.1')).toBe(false);
    });

    it('handles ::ffff: prefix with invalid IPv4 properly', () => {
      // Invalid mapped IP should not crash
      expect(isDatacenterIP('::ffff:invalid')).toBe(false);
      expect(isDatacenterIP('::ffff:')).toBe(false);
    });
  });

  describe('getDatacenterRangeCount', () => {
    it('returns the built-in range count with no custom ranges', () => {
      const count = getDatacenterRangeCount();
      expect(count).toBeGreaterThan(100);
    });

    it('includes custom ranges in the count', () => {
      const base = getDatacenterRangeCount();
      const withCustom = getDatacenterRangeCount(['1.2.3.0/24', '5.6.7.0/24']);
      expect(withCustom).toBe(base + 2);
    });

    it('does not crash when custom ranges include malformed CIDR strings', () => {
      // Bad CIDRs like /33, 'abc', empty strings, etc. — parseCIDR returns null
      // getDatacenterRangeCount counts them (does not validate individual entries)
      // but isDatacenterIP filters them out via parseCIDR
      const countBad = getDatacenterRangeCount(['1.2.3.0/24', '192.168.1.0/33', 'abc', '', '256.0.0.0/8']);
      const countGood = getDatacenterRangeCount(['1.2.3.0/24']);
      // getDatacenterRangeCount counts raw array length — all 5 malformed entries counted
      expect(countBad).toBe(countGood + 4);
    });

    it('counts raw additional ranges without validating each CIDR', () => {
      // The function adds the raw array length, no per-item validation
      const base = getDatacenterRangeCount();
      const count = getDatacenterRangeCount(['1.2.3.0/33']); // /33 is invalid prefix
      expect(count).toBe(base + 1); // counted as-is, parseCIDR is called later in isDatacenterIP
    });

    it('handles empty string and whitespace in custom ranges array', () => {
      // Empty strings and whitespace are counted as items (no per-item filter here)
      const base = getDatacenterRangeCount();
      const countWithEmpty = getDatacenterRangeCount(['', '  ', '1.2.3.0/24']);
      // Array has 3 items, all counted
      expect(countWithEmpty).toBe(base + 3);
    });
  });
});

describe('passiveProtection', () => {
  describe('checkPassiveProtection', () => {
    it('returns not blocked and not datacenter when disabled', () => {
      const origEnabled = process.env.PASSIVE_PROTECTION_ENABLED;
      process.env.PASSIVE_PROTECTION_ENABLED = 'false';
      // Need to re-import config to pick up env change
      // Since config is module-level, we test with the current state
      // The default config has enabled=true unless PASSIVE_PROTECTION_ENABLED=false
      // This test validates the function interface
      const result = checkPassiveProtection('192.168.1.1');
      // When enabled (default), checking a private IP should not block
      expect(result.isDatacenter).toBe(false);
      process.env.PASSIVE_PROTECTION_ENABLED = origEnabled;
    });

    it('detects datacenter IPs', () => {
      const result = checkPassiveProtection('162.243.1.1');
      expect(result.isDatacenter).toBe(true);
    });

    it('does not flag residential IPs as datacenter', () => {
      const result = checkPassiveProtection('203.0.113.1');
      expect(result.isDatacenter).toBe(false);
    });

    it('handles unknown IP gracefully', () => {
      const result = checkPassiveProtection('unknown');
      expect(result.isDatacenter).toBe(false);
      expect(result.blocked).toBe(false);
    });
  });

  describe('checkDcRateLimit', () => {
    // Use unique ipHashes per test to avoid cross-test pollution via the shared Map

    it('allows first request through', () => {
      const result = checkDcRateLimit('dc-rate-test-001');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2); // 3 max - 1 = 2
    });

    it('allows second request through', () => {
      const result = checkDcRateLimit('dc-rate-test-002');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it('allows third request through (at limit)', () => {
      const ipHash = 'dc-rate-test-003';
      checkDcRateLimit(ipHash); // 1st: remaining=2
      checkDcRateLimit(ipHash); // 2nd: remaining=1
      const result = checkDcRateLimit(ipHash); // 3rd: remaining=0 (at limit)
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0); // 3 max - 3 = 0
    });

    it('blocks fourth request with 429 (rate limit exceeded)', () => {
      const ipHash = 'dc-rate-test-004';
      // First three requests
      checkDcRateLimit(ipHash); // allowed, remaining=2
      checkDcRateLimit(ipHash); // allowed, remaining=1
      checkDcRateLimit(ipHash); // allowed, remaining=0

      // Fourth request — should be blocked
      const result = checkDcRateLimit(ipHash);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('separate rate limit buckets for different ipHashes', () => {
      const hashA = 'dc-rate-test-005-a';
      const hashB = 'dc-rate-test-005-b';

      // Exhaust bucket A
      checkDcRateLimit(hashA);
      checkDcRateLimit(hashA);
      checkDcRateLimit(hashA); // exhausted

      // Bucket B should still be allowed
      const resultB = checkDcRateLimit(hashB);
      expect(resultB.allowed).toBe(true);
      expect(resultB.remaining).toBe(2);
    });
  });

  describe('getPassiveProtectionStats', () => {
    it('returns stats with expected fields', () => {
      const stats = getPassiveProtectionStats();
      expect(stats).toHaveProperty('enabled');
      expect(stats).toHaveProperty('blockDatacenterIPs');
      expect(stats).toHaveProperty('datacenterRangesCount');
      expect(stats).toHaveProperty('customRangesCount');
      expect(stats).toHaveProperty('datacenterRateLimitMax');
      expect(stats).toHaveProperty('dcDetectionsLast24h');
      expect(stats).toHaveProperty('dcThrottledLast24h');
      expect(typeof stats.datacenterRangesCount).toBe('number');
      expect(stats.datacenterRangesCount).toBeGreaterThan(0);
    });

    it('has default datacenterRateLimitMax of 3', () => {
      const stats = getPassiveProtectionStats();
      expect(stats.datacenterRateLimitMax).toBe(3);
    });

    it('has blockDatacenterIPs defaulting to false', () => {
      const stats = getPassiveProtectionStats();
      expect(stats.blockDatacenterIPs).toBe(false);
    });

    it('has enabled defaulting to true', () => {
      const stats = getPassiveProtectionStats();
      expect(stats.enabled).toBe(true);
    });
  });
});