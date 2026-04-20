export interface Challenge {
  id: string;
  nonce: string;
  difficulty: number;
  expiresAt: number;
}

export interface Session {
  id: string;
  createdAt: number;
  mouseScore: number;
  keyboardScore: number;
  timingScore: number;
  powScore: number;
  timingOracleScore: number;
  tremorScore: number;
  webrtcOracleScore: number;
  finalScore: number;
  verdict: 'human' | 'bot' | 'suspicious' | 'pending';
  verdictToken: string | null;
  ipHash: string;
  userAgent: string;
}

export interface VerifyResult {
  valid: boolean;
  verdict: string;
  score: number;
}
