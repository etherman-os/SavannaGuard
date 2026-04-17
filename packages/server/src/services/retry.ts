import { FederationError } from './federation-errors.js';
import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  context?: string;
}

function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxDelayMs);
  const jitter = Math.random() * capped * 0.3;
  return Math.min(capped + jitter, maxDelayMs);
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, context = 'federation:retry' } = options;
  let lastError: FederationError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (!(error instanceof FederationError)) {
        throw error;
      }

      lastError = error;

      if (!error.retryable) {
        logger.warn(context, 'Non-retryable error, giving up', {
          error: error.message,
          type: error.constructor.name,
          attempt: String(attempt),
        });
        throw error;
      }

      if (attempt >= maxRetries) {
        logger.warn(context, 'Max retries exceeded', {
          error: error.message,
          type: error.constructor.name,
          maxRetries: String(maxRetries),
        });
        throw error;
      }

      const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
      logger.warn(context, 'Retrying after error', {
        error: error.message,
        type: error.constructor.name,
        attempt: String(attempt + 1),
        maxRetries: String(maxRetries),
        delayMs: String(Math.round(delay)),
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error('Retry loop exited unexpectedly');
}