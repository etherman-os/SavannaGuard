export abstract class FederationError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly peerUrl?: string;

  constructor(message: string, opts: { retryable: boolean; statusCode?: number; peerUrl?: string; cause?: Error }) {
    super(message, { cause: opts.cause });
    this.name = this.constructor.name;
    this.retryable = opts.retryable;
    this.statusCode = opts.statusCode;
    this.peerUrl = opts.peerUrl;
  }
}

export class NetworkError extends FederationError {
  constructor(peerUrl: string, cause?: Error) {
    super(`Network error communicating with peer ${peerUrl}`, { retryable: true, peerUrl, cause });
  }
}

export class TimeoutError extends FederationError {
  constructor(peerUrl: string) {
    super(`Request to peer ${peerUrl} timed out`, { retryable: true, peerUrl });
  }
}

export class AuthError extends FederationError {
  constructor(peerUrl: string, statusCode: number) {
    super(`Authentication failed with peer ${peerUrl} (HTTP ${statusCode})`, { retryable: false, statusCode, peerUrl });
  }
}

export class ServerError extends FederationError {
  constructor(peerUrl: string, statusCode: number) {
    super(`Server error from peer ${peerUrl} (HTTP ${statusCode})`, { retryable: true, statusCode, peerUrl });
  }
}

export class RateLimitError extends FederationError {
  readonly retryAfterMs: number;

  constructor(peerUrl: string, retryAfterMs: number) {
    super(`Rate limited by peer ${peerUrl}`, { retryable: true, statusCode: 429, peerUrl });
    this.retryAfterMs = retryAfterMs;
  }
}

export class ParseError extends FederationError {
  constructor(peerUrl: string, cause?: Error) {
    super(`Failed to parse response from peer ${peerUrl}`, { retryable: false, peerUrl, cause });
  }
}

export class PayloadTooLargeError extends FederationError {
  readonly contentLength: number;
  readonly maxBytes: number;

  constructor(peerUrl: string, contentLength: number, maxBytes: number) {
    super(`Payload from peer ${peerUrl} too large (${contentLength} > ${maxBytes})`, { retryable: false, peerUrl });
    this.contentLength = contentLength;
    this.maxBytes = maxBytes;
  }
}

export function classifyFetchError(error: unknown, peerUrl: string): FederationError {
  if (error instanceof FederationError) return error;

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new TimeoutError(peerUrl);
  }

  if (error instanceof TypeError && error.message.includes('fetch')) {
    return new NetworkError(peerUrl, error instanceof Error ? error : undefined);
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('econnreset')) {
      return new NetworkError(peerUrl, error);
    }
    if (msg.includes('timed out') || msg.includes('timeout') || msg.includes('abort')) {
      return new TimeoutError(peerUrl);
    }
  }

  return new NetworkError(peerUrl, error instanceof Error ? error : undefined);
}

export function classifyHttpResponse(statusCode: number, peerUrl: string): FederationError | null {
  if (statusCode === 401 || statusCode === 403) {
    return new AuthError(peerUrl, statusCode);
  }
  if (statusCode === 429) {
    return new RateLimitError(peerUrl, 60_000);
  }
  if (statusCode >= 500) {
    return new ServerError(peerUrl, statusCode);
  }
  return null;
}