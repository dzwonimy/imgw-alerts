import {
  writeEvent,
  createSentEvent,
  createFailedEvent,
  createSkippedEvent,
  generatePartitionKey,
  generateSortKey,
  extractAlertId,
  AlertEvent,
} from '../services/worker/event-logger';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AlertConfig } from '../services/worker/alert-evaluator';
import { ImgwMeasurement } from '../services/worker/imgw-client';

// Mock AWS SDK
jest.mock('@aws-sdk/lib-dynamodb');

describe('EventLogger', () => {
  let mockSend: jest.Mock;
  let mockClient: jest.Mocked<DynamoDBDocumentClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend = jest.fn().mockResolvedValue({});
    mockClient = {
      send: mockSend,
    } as unknown as jest.Mocked<DynamoDBDocumentClient>;

    // Mock DynamoDBDocumentClient.from
    (DynamoDBDocumentClient.from as jest.Mock) = jest.fn().mockReturnValue(mockClient);
    
    // Mock PutCommand to preserve input structure
    jest.spyOn(require('@aws-sdk/lib-dynamodb'), 'PutCommand').mockImplementation(
      (input: any) => {
        const command = Object.create(PutCommand.prototype);
        command.input = input;
        return command;
      }
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generatePartitionKey', () => {
    it('should generate correct partition key', () => {
      expect(generatePartitionKey('149200090', 'default')).toBe(
        'ALERT#149200090#default'
      );
      expect(generatePartitionKey('123', 'alert-1')).toBe('ALERT#123#alert-1');
    });
  });

  describe('generateSortKey', () => {
    it('should generate sort key with timestamp and random', () => {
      const timestamp = '2026-02-06T10:00:00.000Z';
      const sk = generateSortKey(timestamp);
      expect(sk).toMatch(/^MEASUREMENT#2026-02-06T10-00-00-000Z#/);
      expect(sk).not.toBe(generateSortKey(timestamp)); // Should be unique
    });
  });

  describe('extractAlertId', () => {
    it('should extract alert ID from alert sk', () => {
      expect(extractAlertId('149200090#default')).toBe('default');
      expect(extractAlertId('149200090#alert-1')).toBe('alert-1');
      expect(extractAlertId('149200090')).toBe('default'); // Fallback if no #
    });
  });

  describe('writeEvent', () => {
    const sampleEvent: Omit<AlertEvent, 'pk' | 'sk'> = {
      stationId: '149200090',
      alertSk: '149200090#default',
      level: 245.5,
      measurementTimeIso: '2026-02-06T10:00:00.000Z',
      matched: true,
      attemptedAt: '2026-02-06T10:05:00.000Z',
      sentAt: '2026-02-06T10:05:00.000Z',
      status: 'SENT',
      telegramMessageId: 12345,
    };

    it('should write event to DynamoDB with correct structure', async () => {
      await writeEvent(sampleEvent, { tableName: 'WaterAlertEvents' });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const putCommand = mockSend.mock.calls[0][0];
      expect(putCommand).toBeInstanceOf(PutCommand);
      // Access the input property - AWS SDK v3 commands store params in input
      const commandInput = (putCommand as PutCommand).input;
      expect(commandInput).toBeDefined();
      expect(commandInput.TableName).toBe('WaterAlertEvents');
      expect(commandInput.Item).toMatchObject({
        pk: 'ALERT#149200090#default',
        sk: expect.stringMatching(/^MEASUREMENT#2026-02-06T10-00-00-000Z#/),
        stationId: '149200090',
        alertSk: '149200090#default',
        level: 245.5,
        measurementTimeIso: '2026-02-06T10:00:00.000Z',
        matched: true,
        attemptedAt: '2026-02-06T10:05:00.000Z',
        sentAt: '2026-02-06T10:05:00.000Z',
        status: 'SENT',
        telegramMessageId: 12345,
      });
    });

    it('should include TTL if specified', async () => {
      await writeEvent(sampleEvent, {
        tableName: 'WaterAlertEvents',
        ttlDays: 30,
      });

      const putCommand = mockSend.mock.calls[0][0];
      const commandInput = (putCommand as PutCommand).input;
      expect(commandInput).toBeDefined();
      const item = commandInput.Item as AlertEvent;
      expect(item.ttlEpochSeconds).toBeDefined();
      expect(typeof item.ttlEpochSeconds).toBe('number');
      // TTL should be approximately 30 days from now
      const expectedTtl = Math.floor(
        (Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000
      );
      expect(item.ttlEpochSeconds).toBeGreaterThan(expectedTtl - 10);
      expect(item.ttlEpochSeconds).toBeLessThan(expectedTtl + 10);
    });

    it('should not include TTL if not specified', async () => {
      await writeEvent(sampleEvent, { tableName: 'WaterAlertEvents' });

      const putCommand = mockSend.mock.calls[0][0];
      const commandInput = (putCommand as PutCommand).input;
      expect(commandInput).toBeDefined();
      const item = commandInput.Item as AlertEvent;
      expect(item.ttlEpochSeconds).toBeUndefined();
    });

    it('should use provided DynamoDB client', async () => {
      const customClient = {
        send: jest.fn().mockResolvedValue({}),
      } as unknown as DynamoDBDocumentClient;

      await writeEvent(sampleEvent, {
        tableName: 'WaterAlertEvents',
        dynamoClient: customClient,
      });

      expect(customClient.send).toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('createSentEvent', () => {
    const alert: AlertConfig = {
      stationId: '149200090',
      minLevel: 235,
      maxLevel: 260,
      enabled: true,
      telegramChatId: '123456789',
      name: 'Dobczyce (Raba)',
    };

    const measurement: ImgwMeasurement = {
      level: 245.5,
      measurementTime: '2026-02-06T10:00:00.000Z',
      rawData: {},
    };

    it('should create SENT event with all required fields', () => {
      const event = createSentEvent(alert, measurement, 12345, '149200090#default');

      expect(event.status).toBe('SENT');
      expect(event.stationId).toBe('149200090');
      expect(event.alertSk).toBe('149200090#default');
      expect(event.level).toBe(245.5);
      expect(event.measurementTimeIso).toBe('2026-02-06T10:00:00.000Z');
      expect(event.matched).toBe(true);
      expect(event.telegramMessageId).toBe(12345);
      expect(event.attemptedAt).toBeDefined();
      expect(event.sentAt).toBeDefined();
      expect(event.attemptedAt).toBe(event.sentAt);
      expect(event.error).toBeUndefined();
    });
  });

  describe('createFailedEvent', () => {
    const alert: AlertConfig = {
      stationId: '149200090',
      minLevel: 235,
      maxLevel: 260,
      enabled: true,
      telegramChatId: '123456789',
    };

    const measurement: ImgwMeasurement = {
      level: 245.5,
      measurementTime: '2026-02-06T10:00:00.000Z',
      rawData: {},
    };

    it('should create FAILED event with error message string', () => {
      const event = createFailedEvent(
        alert,
        measurement,
        'Network error',
        '149200090#default'
      );

      expect(event.status).toBe('FAILED');
      expect(event.stationId).toBe('149200090');
      expect(event.level).toBe(245.5);
      expect(event.matched).toBe(true);
      expect(event.error).toBe('Network error');
      expect(event.attemptedAt).toBeDefined();
      expect(event.sentAt).toBeUndefined();
      expect(event.telegramMessageId).toBeUndefined();
    });

    it('should create FAILED event with Error object', () => {
      const error = new Error('Telegram API error');
      const event = createFailedEvent(alert, measurement, error, '149200090#default');

      expect(event.status).toBe('FAILED');
      expect(event.error).toBe('Telegram API error');
    });
  });

  describe('createSkippedEvent', () => {
    const alert: AlertConfig = {
      stationId: '149200090',
      minLevel: 235,
      maxLevel: 260,
      enabled: true,
      telegramChatId: '123456789',
    };

    const measurement: ImgwMeasurement = {
      level: 245.5,
      measurementTime: '2026-02-06T10:00:00.000Z',
      rawData: {},
    };

    it('should create SKIPPED event', () => {
      const event = createSkippedEvent(alert, measurement, '149200090#default');

      expect(event.status).toBe('SKIPPED');
      expect(event.stationId).toBe('149200090');
      expect(event.level).toBe(245.5);
      expect(event.matched).toBe(true);
      expect(event.attemptedAt).toBeDefined();
      expect(event.sentAt).toBeUndefined();
      expect(event.error).toBeUndefined();
      expect(event.telegramMessageId).toBeUndefined();
    });
  });
});
