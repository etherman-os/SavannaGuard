export interface ChallengeResponse {
  challengeId: string;
  nonce: string;
  difficulty: number;
  sessionId: string;
}

export interface SolveResponse {
  success: boolean;
  token: string | null;
  score: number;
  verdict: string;
}

export interface BehavioralData {
  straightLineRatio: number;
  timeOnPage: number;
}