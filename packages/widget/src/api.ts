import type { ChallengeResponse, SolveResponse, BehavioralData } from './types.js';

let apiUrl = '';

export function setApiUrl(url: string) {
  apiUrl = url.replace(/\/$/, '');
}

export async function createChallenge(): Promise<ChallengeResponse> {
  const res = await fetch(`${apiUrl}/api/v1/challenge/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`challenge/create failed: ${res.status}`);
  }
  return res.json();
}

export async function solveChallenge(
  challengeId: string,
  solution: string,
  sessionId: string,
  behavioral: BehavioralData
): Promise<SolveResponse> {
  const res = await fetch(`${apiUrl}/api/v1/challenge/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId,
      solution,
      sessionId,
      mouseData: {
        straightLineRatio: behavioral.straightLineRatio,
        velocity: behavioral.mouseVelocity,
        maxVelocity: behavioral.maxVelocity,
        directionChanges: behavioral.directionChanges,
      },
      timingData: {
        timeOnPageMs: behavioral.timeOnPage,
      },
      keyboardData: {
        avgDwellTime: behavioral.avgDwellTime,
        avgFlightTime: behavioral.avgFlightTime,
        dwellVariance: behavioral.dwellVariance,
        flightVariance: behavioral.flightVariance,
        totalKeystrokes: behavioral.totalKeystrokes,
      },
      canvasData: {
        canvasHash: behavioral.canvasHash,
        isCanvasSupported: behavioral.isCanvasSupported,
      },
      webglData: {
        renderer: behavioral.webglRenderer,
        vendor: behavioral.webglVendor,
        hasWebGL: behavioral.hasWebGL,
      },
      screenData: {
        width: behavioral.screenWidth,
        height: behavioral.screenHeight,
        colorDepth: behavioral.colorDepth,
        pixelRatio: behavioral.pixelRatio,
      },
      navigatorData: {
        userAgent: behavioral.userAgent,
        platform: behavioral.platform,
        language: behavioral.language,
        timezone: behavioral.timezone,
        timezoneOffset: behavioral.timezoneOffset,
        hardwareConcurrency: behavioral.hardwareConcurrency,
        maxTouchPoints: behavioral.maxTouchPoints,
      },
      networkData: {
        latencyMs: behavioral.latencyMs,
        effectiveType: behavioral.networkType,
        downlink: behavioral.networkDownlink,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`challenge/solve failed: ${res.status}`);
  }
  return res.json();
}
