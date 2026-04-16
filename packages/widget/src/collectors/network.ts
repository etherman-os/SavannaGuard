export interface NetworkData {
  latency: number;
  connectionType: string | null;
  downlink: number | null;
  effectiveType: string | null;
}

export function collectNetworkData(): NetworkData {
  const defaultData: NetworkData = {
    latency: 0,
    connectionType: null,
    downlink: null,
    effectiveType: null,
  };

  if (typeof navigator === 'undefined') {
    return defaultData;
  }

  const connection = (navigator as Record<string, unknown>).connection as Record<string, unknown> | undefined;

  if (!connection) {
    return defaultData;
  }

  return {
    connectionType: (connection.effectiveType as string) || null,
    downlink: (connection.downlink as number) || null,
    effectiveType: (connection.effectiveType as string) || null,
    latency: 0,
  };
}

export async function measureLatency(apiUrl: string): Promise<number> {
  if (typeof fetch === 'undefined') return 0;

  try {
    const start = performance.now();
    await fetch(`${apiUrl}/health`, { method: 'GET', mode: 'no-cors' });
    const end = performance.now();
    return Math.round(end - start);
  } catch {
    return 0;
  }
}

export function scoreNetwork(data: NetworkData, latency: number): number {
  let score = 65;

  if (latency > 500) score -= 15;
  else if (latency > 200) score -= 5;
  else if (latency < 100 && latency > 0) score += 10;

  if (data.effectiveType === 'slow-2g') score -= 20;
  else if (data.effectiveType === '2g') score -= 15;
  else if (data.effectiveType === '3g') score -= 5;
  else if (data.effectiveType === '4g') score += 10;

  if (data.downlink !== null) {
    if (data.downlink < 0.5) score -= 10;
    else if (data.downlink > 5) score += 10;
  }

  return Math.max(0, Math.min(100, score));
}
