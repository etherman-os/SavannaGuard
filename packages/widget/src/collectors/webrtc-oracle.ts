/**
 * WebRTC Network Topology Oracle
 *
 * Detects local network topology characteristics by passively harvesting
 * host ICE candidates without configured STUN/TURN servers.
 *
 * Detection signals:
 * - RFC1918 private IP presence (real NAT environment)
 * - ICE candidate types and counts
 * - Single-interface indicators (datacenter/VM)
 * - VPN/topology mismatch heuristics from local candidates only
 */

export interface WebRTCOracleData {
  iceCandidateCount: number;       // Total ICE candidates gathered
  localIPCount: number;           // Unique local IPs
  hasRFC1918Local: boolean;       // Has private IP (real NAT)
  hasSrflxCandidate: boolean;      // Has server-reflexive candidate
  hasRelayedCandidate: boolean;    // Has TURN relayed candidate
  hasPrflxCandidate: boolean;      // Has peer-reflexive candidate
  likelyDatacenter: boolean;       // Single interface, no RFC1918
  likelyVPN: boolean;              // Mismatch between connection type and topology
  networkComplexity: number;       // Interface diversity score (0-1)
  collected: boolean;              // Whether collection succeeded
}

// RFC1918 private address ranges
const RFC1918_RANGES = [
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
];

const COLLECTION_TIMEOUT_MS = 2500;

function isRFC1918Address(ip: string): boolean {
  if (!ip || ip === '0.0.0.0' || ip === '127.0.0.1') return false;

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;

  const num = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];

  for (const range of RFC1918_RANGES) {
    const startParts = range.start.split('.').map(Number);
    const endParts = range.end.split('.').map(Number);

    const startNum = (startParts[0] << 24) | (startParts[1] << 16) | (startParts[2] << 8) | startParts[3];
    const endNum = (endParts[0] << 24) | (endParts[1] << 16) | (endParts[2] << 8) | endParts[3];

    if (num >= startNum && num <= endNum) {
      return true;
    }
  }

  return false;
}

interface ICECandidate {
  type: string;
  address: string;
  port: number;
  protocol: string;
}

export async function collectWebRTCOracle(): Promise<WebRTCOracleData> {
  const fallback: WebRTCOracleData = {
    iceCandidateCount: 0,
    localIPCount: 0,
    hasRFC1918Local: false,
    hasSrflxCandidate: false,
    hasRelayedCandidate: false,
    hasPrflxCandidate: false,
    likelyDatacenter: false,
    likelyVPN: false,
    networkComplexity: 0,
    collected: false,
  };

  // Check if WebRTC is available
  if (typeof RTCPeerConnection !== 'function') {
    return fallback;
  }

  try {
    const candidates: ICECandidate[] = [];
    const localIPs = new Set<string>();

    // Keep the privacy guarantee: do not contact public STUN/TURN services.
    // This limits srflx/relay visibility but avoids third-party network calls.
    const pc = new RTCPeerConnection({ iceServers: [] });

    // Create data channel to trigger ICE gathering
    const dataChannel = pc.createDataChannel('probe', { ordered: false });

    const gatherPromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        pc.close();
        dataChannel.close();
        resolve();
      }, COLLECTION_TIMEOUT_MS);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateStr = event.candidate.candidate;
          const parsed = parseCandidate(candidateStr);
          if (parsed) {
            candidates.push(parsed);
            if (parsed.type === 'host' && parsed.address) {
              localIPs.add(parsed.address);
            }
          }
        } else {
          // Null candidate means end of gathering
          clearTimeout(timeout);
          pc.close();
          dataChannel.close();
          resolve();
        }
      };

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          pc.close();
          dataChannel.close();
          resolve();
        }
      };

      // Create offer to trigger ICE
      pc.createOffer({})
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timeout);
          pc.close();
          dataChannel.close();
          resolve();
        });
    });

    await gatherPromise;

    // Analyze collected candidates
    return analyzeCandidates(candidates, Array.from(localIPs));

  } catch {
    return fallback;
  }
}

function parseCandidate(candidate: string): ICECandidate | null {
  // Format: candidate:foundation protocol port type generation ip ...
  const parts = candidate.split(' ');
  if (parts.length < 8) return null;

  const protocol = parts[2];
  const port = parseInt(parts[5], 10);
  const type = parts[7];
  const ip = parts[4];

  return {
    type,
    address: ip,
    port,
    protocol,
  };
}

function analyzeCandidates(candidates: ICECandidate[], localIPs: string[]): WebRTCOracleData {
  const hasRFC1918Local = localIPs.some((ip) => isRFC1918Address(ip));
  const hasSrflxCandidate = candidates.some((c) => c.type === 'srflx');
  const hasRelayedCandidate = candidates.some((c) => c.type === 'relay');
  const hasPrflxCandidate = candidates.some((c) => c.type === 'prflx');

  // Unique local IPs for complexity score
  const uniqueLocalIPs = new Set(
    candidates.filter((c) => c.type === 'host').map((c) => c.address)
  );

  // Network complexity: 0 = single interface, 1 = multiple interfaces
  const networkComplexity = Math.min(1, uniqueLocalIPs.size / 4);

  // Datacenter detection: no RFC1918 AND single interface
  const likelyDatacenter =
    !hasRFC1918Local && uniqueLocalIPs.size <= 1 && candidates.length < 5;

  // VPN detection: check for inconsistency
  // Get connection type from Network Information API if available
  const connectionType = getConnectionType();
  const likelyVPN = detectVPNLeak(candidates, connectionType);

  return {
    iceCandidateCount: candidates.length,
    localIPCount: uniqueLocalIPs.size,
    hasRFC1918Local,
    hasSrflxCandidate,
    hasRelayedCandidate,
    hasPrflxCandidate,
    likelyDatacenter,
    likelyVPN,
    networkComplexity: Math.round(networkComplexity * 100) / 100,
    collected: true,
  };
}

function getConnectionType(): string | null {
  // Network Information API (Chrome, Edge, Opera)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  if (nav.connection && nav.connection.type) {
    return nav.connection.type;
  }
  return null;
}

function detectVPNLeak(candidates: ICECandidate[], connectionType: string | null): boolean {
  // If we're on a slow connection but have full ICE traversal, suspicious
  if (connectionType === 'cellular' || connectionType === '2g' || connectionType === 'slow-2g') {
    // Real cellular has limited ICE candidates
    if (candidates.length > 10) {
      return true; // Too many candidates for cellular
    }
  }

  // Check for IPv6 vs IPv4 mismatch indicating VPN
  const ipv6Candidates = candidates.filter((c) => c.address.includes(':'));
  const ipv4Candidates = candidates.filter((c) => !c.address.includes(':'));

  // If we have both IPv6 and IPv4, might be VPN
  if (ipv6Candidates.length > 0 && ipv4Candidates.length > 0) {
    // Could be VPN dual-stack, but also could be normal
    // Check for RFC1918 in IPv4 but public in IPv6 = likely VPN
    const hasRFC1918InV4 = ipv4Candidates.some((c) => isRFC1918Address(c.address));
    const hasPublicV6 = ipv6Candidates.some((c) => !c.address.startsWith('fe80'));

    if (hasRFC1918InV4 && hasPublicV6) {
      return true;
    }
  }

  return false;
}
