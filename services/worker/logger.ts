/**
 * Structured logging utility for IMGW alerts worker
 * Ensures secrets are never logged
 */

export interface AlertLogContext {
  stationId: string;
  alertSk?: string;
  level?: number;
  matched?: boolean;
  status?: 'SENT' | 'FAILED' | 'SKIPPED' | 'ERROR';
  error?: string;
  telegramMessageId?: number;
}

/**
 * Sanitizes a value to ensure no secrets are logged
 * @param value Value to sanitize
 * @returns Sanitized value (redacted if looks like a secret)
 */
function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // Redact if it looks like a token (long alphanumeric string)
    if (value.length > 20 && /^[A-Za-z0-9_-]+$/.test(value)) {
      return '[REDACTED]';
    }
    // Redact if contains "token" or "secret" in key name (handled at object level)
    return value;
  }
  return value;
}

/**
 * Sanitizes an object to remove sensitive fields
 * @param obj Object to sanitize
 * @returns Sanitized object
 */
function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const sensitiveKeys = [
    'token',
    'secret',
    'password',
    'apikey',
    'auth',
    'authorization',
    'telegramtoken',
    'bottoken',
  ];

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    // Check if key contains any sensitive keyword (case-insensitive)
    if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>);
    } else {
      sanitized[key] = sanitizeValue(value);
    }
  }

  return sanitized;
}

/**
 * Logs an alert processing event with structured context
 * @param message Log message
 * @param context Alert context (will be sanitized)
 */
export function logAlertEvent(message: string, context: AlertLogContext): void {
  const sanitizedContext = sanitizeObject(context as unknown as Record<string, unknown>);
  console.log(JSON.stringify({
    logLevel: 'INFO', // Use logLevel to avoid conflict with context.level (water level)
    message,
    ...sanitizedContext,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Logs an error with alert context
 * @param message Error message
 * @param error Error object or string
 * @param context Alert context (will be sanitized)
 */
export function logAlertError(
  message: string,
  error: Error | string,
  context?: AlertLogContext
): void {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : undefined;
  
  const logData: Record<string, unknown> = {
    logLevel: 'ERROR', // Use logLevel to avoid conflict with context fields
    message,
    error: errorMessage,
    timestamp: new Date().toISOString(),
  };

  if (errorStack) {
    logData.stack = errorStack;
  }

  if (context) {
    const sanitizedContext = sanitizeObject(context as unknown as Record<string, unknown>);
    Object.assign(logData, sanitizedContext);
  }

  console.error(JSON.stringify(logData));
}

/**
 * Logs a general info message
 * @param message Log message
 * @param data Optional additional data (will be sanitized)
 */
export function logInfo(message: string, data?: Record<string, unknown>): void {
  const logData: Record<string, unknown> = {
    logLevel: 'INFO', // Use logLevel to avoid conflict with context fields
    message,
    timestamp: new Date().toISOString(),
  };

  if (data) {
    const sanitized = sanitizeObject(data);
    Object.assign(logData, sanitized);
  }

  console.log(JSON.stringify(logData));
}
