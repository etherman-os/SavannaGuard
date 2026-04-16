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
      mouseData: { straightLineRatio: behavioral.straightLineRatio },
      timingData: { timeOnPageMs: behavioral.timeOnPage },
    }),
  });
  if (!res.ok) {
    throw new Error(`challenge/solve failed: ${res.status}`);
  }
  return res.json();
}