export interface KeystrokeData {
  avgDwellTime: number;
  avgFlightTime: number;
  dwellVariance: number;
  flightVariance: number;
  totalKeystrokes: number;
}

interface KeystrokeEvent {
  type: 'down' | 'up';
  key: string;
  time: number;
}

export async function collectKeystrokeData(): Promise<KeystrokeData> {
  const events: KeystrokeEvent[] = [];
  const COLLECTION_MS = 4000;

  const downHandler = (e: KeyboardEvent) => {
    events.push({ type: 'down', key: e.key, time: Date.now() });
  };

  const upHandler = (e: KeyboardEvent) => {
    events.push({ type: 'up', key: e.key, time: Date.now() });
  };

  document.addEventListener('keydown', downHandler, { passive: true });
  document.addEventListener('keyup', upHandler, { passive: true });

  await new Promise((resolve) => setTimeout(resolve, COLLECTION_MS));

  document.removeEventListener('keydown', downHandler);
  document.removeEventListener('keyup', upHandler);

  return calculateKeystrokeMetrics(events);
}

function calculateKeystrokeMetrics(events: KeystrokeEvent[]): KeystrokeData {
  const defaultResult: KeystrokeData = {
    avgDwellTime: 80,
    avgFlightTime: 120,
    dwellVariance: 50,
    flightVariance: 80,
    totalKeystrokes: 0,
  };

  if (events.length < 4) return defaultResult;

  const downEvents = events.filter((e) => e.type === 'down');
  const upEvents = events.filter((e) => e.type === 'up');

  if (downEvents.length < 2) return defaultResult;

  const dwellTimes: number[] = [];
  for (let i = 0; i < downEvents.length; i++) {
    const down = downEvents[i];
    const up = upEvents.find((u) => u.key === down.key && u.time > down.time);
    if (up) {
      dwellTimes.push(up.time - down.time);
    }
  }

  const flightTimes: number[] = [];
  const sortedDowns = [...downEvents].sort((a, b) => a.time - b.time);
  for (let i = 1; i < sortedDowns.length; i++) {
    flightTimes.push(sortedDowns[i].time - sortedDowns[i - 1].time);
  }

  const avg = (arr: number[]): number => arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = (arr: number[], mean: number): number => {
    if (arr.length < 2) return 0;
    return arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  };

  const avgDwell = dwellTimes.length > 0 ? avg(dwellTimes) : 80;
  const avgFlight = flightTimes.length > 0 ? avg(flightTimes) : 120;

  return {
    avgDwellTime: Math.round(avgDwell),
    avgFlightTime: Math.round(avgFlight),
    dwellVariance: Math.round(variance(dwellTimes, avgDwell)),
    flightVariance: Math.round(variance(flightTimes, avgFlight)),
    totalKeystrokes: downEvents.length,
  };
}

export function scoreKeystroke(data: KeystrokeData): number {
  let score = 70;

  if (data.totalKeystrokes === 0) return 50;
  if (data.totalKeystrokes < 5) score -= 15;

  if (data.avgDwellTime < 30 || data.avgDwellTime > 300) score -= 10;

  if (data.dwellVariance < 5 && data.totalKeystrokes > 10) {
    score -= 20;
  }

  if (data.avgFlightTime < 30) score -= 10;
  if (data.flightVariance < 10 && data.totalKeystrokes > 10) {
    score -= 15;
  }

  return Math.max(0, Math.min(100, score));
}
