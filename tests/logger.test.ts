import { logAlertEvent, logAlertError, logInfo, AlertLogContext } from '../services/worker/logger';

// Mock console methods
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

describe('Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
  });

  describe('logAlertEvent', () => {
    it('should log structured alert event', () => {
      const context: AlertLogContext = {
        stationId: '149200090',
        alertSk: '149200090#default',
        level: 245.5,
        matched: true,
        status: 'SENT',
        telegramMessageId: 12345,
      };

      logAlertEvent('Alert processed', context);

      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      const logCall = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(logCall.logLevel).toBe('INFO');
      expect(logCall.message).toBe('Alert processed');
      expect(logCall.stationId).toBe('149200090');
      expect(logCall.level).toBe(245.5); // Water level from context
      expect(logCall.matched).toBe(true);
      expect(logCall.status).toBe('SENT');
      expect(logCall.timestamp).toBeDefined();
    });

    it('should redact sensitive fields', () => {
      const context: AlertLogContext = {
        stationId: '149200090',
        // Simulate a context that might have sensitive data
      };

      // Add sensitive data to context (should be redacted)
      const contextWithSecret = {
        ...context,
        telegramToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        apiKey: 'secret-key-12345',
      } as any;

      logAlertEvent('Alert processed', contextWithSecret);

      const logCall = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(logCall.telegramToken).toBe('[REDACTED]');
      expect(logCall.apiKey).toBe('[REDACTED]');
    });

    it('should handle missing optional fields', () => {
      const context: AlertLogContext = {
        stationId: '149200090',
      };

      logAlertEvent('Alert processed', context);

      const logCall = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(logCall.stationId).toBe('149200090');
      expect(logCall.level).toBeUndefined();
      expect(logCall.matched).toBeUndefined();
    });
  });

  describe('logAlertError', () => {
    it('should log error with context', () => {
      const error = new Error('Telegram API error');
      const context: AlertLogContext = {
        stationId: '149200090',
        status: 'FAILED',
      };

      logAlertError('Failed to send notification', error, context);

      expect(mockConsoleError).toHaveBeenCalledTimes(1);
      const logCall = JSON.parse(mockConsoleError.mock.calls[0][0]);
      expect(logCall.logLevel).toBe('ERROR');
      expect(logCall.message).toBe('Failed to send notification');
      expect(logCall.error).toBe('Telegram API error');
      expect(logCall.stack).toBeDefined();
      expect(logCall.stationId).toBe('149200090');
      expect(logCall.status).toBe('FAILED');
      expect(logCall.timestamp).toBeDefined();
    });

    it('should log error without context', () => {
      const error = new Error('General error');

      logAlertError('Something went wrong', error);

      const logCall = JSON.parse(mockConsoleError.mock.calls[0][0]);
      expect(logCall.logLevel).toBe('ERROR');
      expect(logCall.error).toBe('General error');
      expect(logCall.stationId).toBeUndefined();
    });

    it('should handle string errors', () => {
      logAlertError('Failed', 'String error message');

      const logCall = JSON.parse(mockConsoleError.mock.calls[0][0]);
      expect(logCall.error).toBe('String error message');
      expect(logCall.stack).toBeUndefined();
    });

    it('should redact sensitive data in error context', () => {
      const error = new Error('Error');
      const context = {
        stationId: '149200090',
        botToken: 'secret-token-123',
      } as any;

      logAlertError('Error occurred', error, context);

      const logCall = JSON.parse(mockConsoleError.mock.calls[0][0]);
      expect(logCall.botToken).toBe('[REDACTED]');
    });
  });

  describe('logInfo', () => {
    it('should log info message', () => {
      logInfo('Worker started');

      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      const logCall = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(logCall.logLevel).toBe('INFO');
      expect(logCall.message).toBe('Worker started');
      expect(logCall.timestamp).toBeDefined();
    });

    it('should log info with additional data', () => {
      logInfo('Processing alerts', {
        alertCount: 5,
        enabledCount: 3,
      });

      const logCall = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(logCall.alertCount).toBe(5);
      expect(logCall.enabledCount).toBe(3);
    });

    it('should redact sensitive data in additional data', () => {
      logInfo('Info message', {
        token: 'secret-token',
        password: 'my-password',
      });

      const logCall = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(logCall.token).toBe('[REDACTED]');
      expect(logCall.password).toBe('[REDACTED]');
    });
  });
});
