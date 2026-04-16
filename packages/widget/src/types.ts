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
  avgDwellTime?: number;
  avgFlightTime?: number;
  dwellVariance?: number;
  flightVariance?: number;
  totalKeystrokes?: number;
  canvasHash?: string;
  isCanvasSupported?: boolean;
  webglRenderer?: string;
  webglVendor?: string;
  hasWebGL?: boolean;
  screenWidth?: number;
  screenHeight?: number;
  colorDepth?: number;
  pixelRatio?: number;
  userAgent?: string;
  platform?: string;
  language?: string;
  timezone?: string;
  timezoneOffset?: number;
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
  networkType?: string;
  networkDownlink?: number;
  latencyMs?: number;
  mouseVelocity?: number;
  maxVelocity?: number;
  directionChanges?: number;
  totalMovement?: number;
}
