type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const env = process.env.LOG_LEVEL ?? 'info';
  const normalized = env.toLowerCase() as LogLevel;
  if (normalized in LOG_LEVELS) return normalized;
  return 'info';
}

let currentLevel: LogLevel = getConfiguredLevel();

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, context: string, message: string, data?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${level.toUpperCase()}] [${context}]`;

  if (data && Object.keys(data).length > 0) {
    const dataStr = Object.entries(data)
      .map(([k, v]) => {
        if (typeof v === 'string') return `${k}=${v}`;
        return `${k}=${JSON.stringify(v)}`;
      })
      .join(' ');
    return `${timestamp} ${prefix} ${message} ${dataStr}`;
  }

  return `${timestamp} ${prefix} ${message}`;
}

export const logger = {
  debug(context: string, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog('debug')) return;
    console.debug(formatMessage('debug', context, message, data));
  },

  info(context: string, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog('info')) return;
    console.info(formatMessage('info', context, message, data));
  },

  warn(context: string, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog('warn')) return;
    console.warn(formatMessage('warn', context, message, data));
  },

  error(context: string, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog('error')) return;
    console.error(formatMessage('error', context, message, data));
  },

  setLevel(level: LogLevel): void {
    currentLevel = level;
  },

  getLevel(): LogLevel {
    return currentLevel;
  },
};