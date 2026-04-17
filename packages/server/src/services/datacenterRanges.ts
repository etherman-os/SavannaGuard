export function ipToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) return 0;
  return (
    ((parseInt(parts[0], 10) << 24) |
    (parseInt(parts[1], 10) << 16) |
    (parseInt(parts[2], 10) << 8) |
    parseInt(parts[3], 10)) >>> 0
  );
}

interface ParsedCIDR {
  network: number;
  mask: number;
}

function parseCIDR(cidr: string): ParsedCIDR | null {
  const [ipPart, prefixStr] = cidr.split('/');
  if (!ipPart || !prefixStr) return null;

  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return null;

  const ip = ipToInt(ipPart);
  if (ip === 0 && ipPart !== '0.0.0.0') return null;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;

  return {
    network: (ip & mask) >>> 0,
    mask,
  };
}

let cachedRanges: ParsedCIDR[] | null = null;

function getCompiledRanges(additionalRanges: string[]): ParsedCIDR[] {
  if (cachedRanges === null) {
    cachedRanges = DATACENTER_CIDRS
      .map(parseCIDR)
      .filter((r): r is ParsedCIDR => r !== null);
  }

  if (additionalRanges.length === 0) return cachedRanges;

  return [
    ...cachedRanges,
    ...additionalRanges.map(parseCIDR).filter((r): r is ParsedCIDR => r !== null),
  ];
}

export function isInCIDR(ip: string, cidr: string): boolean {
  const parsed = parseCIDR(cidr);
  if (!parsed) return false;
  const ipInt = ipToInt(ip);
  return ((ipInt & parsed.mask) >>> 0) === parsed.network;
}

export function isDatacenterIP(ip: string, additionalRanges: string[] = []): boolean {
  if (!ip || ip === 'unknown') return false;

  // Strip ::ffff: IPv6-mapped IPv4 prefix
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return false;

  const octets = ip.split('.').map(Number);
  if (octets.some(o => o < 0 || o > 255)) return false;

  if (octets[0] === 10) return false;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return false;
  if (octets[0] === 192 && octets[1] === 168) return false;
  if (octets[0] === 127) return false;

  const ranges = getCompiledRanges(additionalRanges);
  const ipInt = ipToInt(ip);

  for (const range of ranges) {
    if (((ipInt & range.mask) >>> 0) === range.network) {
      return true;
    }
  }

  return false;
}

export function getDatacenterRangeCount(additionalRanges: string[] = []): number {
  return DATACENTER_CIDRS.length + additionalRanges.length;
}

const DATACENTER_CIDRS: readonly string[] = [
  // DigitalOcean
  '162.243.0.0/16', '128.199.0.0/16', '68.183.0.0/16',
  '159.65.0.0/16', '139.59.0.0/16', '138.68.0.0/16',
  '178.128.0.0/16', '46.101.0.0/16', '174.138.0.0/16',
  '206.189.0.0/16', '143.110.0.0/16', '161.35.0.0/16',
  '143.198.0.0/16', '64.225.0.0/16', '64.176.0.0/16',

  // Linode / Akamai
  '45.33.0.0/17', '45.56.0.0/17', '50.116.0.0/18',
  '66.175.208.0/20', '66.228.32.0/19', '69.164.192.0/19',
  '72.14.176.0/20', '96.126.96.0/19', '139.144.0.0/16',
  '172.232.0.0/14', '173.230.128.0/18', '173.255.192.0/18',
  '178.79.128.0/17', '192.155.80.0/20', '198.58.96.0/19',

  // Vultr
  '45.63.0.0/17', '45.76.0.0/15',
  '66.42.0.0/16', '78.141.192.0/18', '95.179.0.0/16',
  '104.156.224.0/19', '108.61.0.0/16', '136.244.0.0/16',
  '137.220.32.0/19', '149.28.0.0/16', '155.138.128.0/17',
  '207.148.0.0/17', '208.167.224.0/19',

  // Hetzner
  '49.12.0.0/16', '49.13.0.0/16', '65.108.0.0/16',
  '65.109.0.0/16', '78.46.0.0/15', '85.10.192.0/18',
  '88.198.0.0/16', '88.99.0.0/16', '94.130.0.0/16',
  '116.202.0.0/16', '116.203.0.0/16', '136.243.0.0/16',
  '138.201.0.0/16', '148.251.0.0/16', '159.69.0.0/16',
  '162.55.0.0/16', '167.86.64.0/18', '168.119.0.0/16',
  '176.9.0.0/16', '195.201.0.0/16', '213.133.96.0/19',
  '213.239.192.0/18',

  // OVH
  '5.39.0.0/17', '37.59.0.0/16', '37.187.0.0/16',
  '46.105.0.0/16', '51.15.0.0/16', '51.68.0.0/16',
  '51.77.0.0/16', '51.79.0.0/16', '51.81.0.0/16',
  '51.83.0.0/16', '51.91.0.0/16', '51.158.0.0/15',
  '51.210.0.0/16', '51.222.0.0/16', '54.36.0.0/16',
  '54.37.0.0/16', '54.38.0.0/16', '91.121.0.0/16',
  '92.222.0.0/15', '94.23.0.0/16', '135.125.0.0/17',
  '137.74.0.0/16', '141.94.0.0/16', '141.95.0.0/16',
  '145.239.0.0/16', '146.59.0.0/16', '152.228.0.0/16',
  '158.69.0.0/16', '164.132.0.0/16', '167.114.0.0/17',
  '176.31.0.0/16', '178.32.0.0/16', '178.33.0.0/18',
  '185.12.32.0/19', '188.165.0.0/16', '192.95.0.0/18',
  '192.99.0.0/16', '198.27.64.0/18', '198.50.128.0/17',
  '213.186.32.0/19', '213.251.128.0/18',

  // AWS (commonly abused ranges)
  '3.0.0.0/9', '34.192.0.0/12', '35.160.0.0/13',
  '44.192.0.0/11', '52.0.0.0/11', '54.0.0.0/8',
  '63.32.0.0/14', '100.24.0.0/14', '107.20.0.0/14',
  '174.129.0.0/16', '184.72.0.0/15', '204.236.128.0/17',
  '23.20.0.0/14', '50.16.0.0/15', '67.202.0.0/18',

  // Google Cloud
  '34.64.0.0/12', '34.128.0.0/10', '35.184.0.0/14',
  '35.192.0.0/12', '104.154.0.0/15', '104.196.0.0/14',

  // Microsoft Azure
  '20.36.0.0/14', '20.42.0.0/15', '20.150.0.0/15',
  '40.64.0.0/13', '40.74.0.0/15', '40.76.0.0/14',
  '40.80.0.0/12', '40.112.0.0/13', '40.120.0.0/14',
  '52.96.0.0/12', '52.224.0.0/15',

  // Oracle Cloud
  '129.146.0.0/16', '129.148.0.0/16', '129.150.0.0/16',
  '129.152.0.0/16', '129.153.0.0/16', '132.145.0.0/16',
  '138.1.0.0/16', '140.204.0.0/16', '141.144.0.0/16',
  '141.147.0.0/16', '147.154.0.0/16', '150.136.0.0/16',
  '152.67.0.0/16', '152.69.0.0/16', '152.70.0.0/16',
  '155.248.0.0/16', '158.101.0.0/16', '168.138.0.0/16',
];