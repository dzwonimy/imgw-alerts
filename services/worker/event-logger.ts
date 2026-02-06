import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AlertConfig } from './alert-evaluator';
import { ImgwMeasurement } from './imgw-client';

/**
 * Event logger for writing alert events to DynamoDB WaterAlertEvents table
 */

export type EventStatus = 'SENT' | 'FAILED' | 'SKIPPED';

export interface AlertEvent {
  pk: string; // "ALERT#{stationId}#{alertId}"
  sk: string; // "MEASUREMENT#{measurementTimestampIso}#{ulid}"
  stationId: string;
  alertSk?: string; // Original alert sk (e.g., "149200090#default")
  level: number;
  measurementTimeRaw?: string; // Raw timestamp from IMGW
  measurementTimeIso: string; // ISO timestamp
  matched: boolean;
  attemptedAt: string; // ISO timestamp
  sentAt?: string; // ISO timestamp (if sent successfully)
  status: EventStatus;
  error?: string;
  telegramMessageId?: number;
  ttlEpochSeconds?: number; // For TTL (optional, set if you want automatic cleanup)
}

export interface EventLoggerOptions {
  tableName: string;
  dynamoClient?: DynamoDBDocumentClient;
  ttlDays?: number; // Optional: set TTL for automatic cleanup (default: no TTL)
}

/**
 * Generates a unique sort key for an event
 * Format: "MEASUREMENT#{measurementTimestampIso}#{random}"
 * @param measurementTime ISO timestamp of the measurement
 * @returns Unique sort key string
 */
export function generateSortKey(measurementTime: string): string {
  // Use timestamp + random to ensure uniqueness
  // Remove colons and special chars from ISO string for cleaner key
  const cleanTimestamp = measurementTime.replace(/[:.]/g, '-');
  const random = Math.random().toString(36).substring(2, 15);
  return `MEASUREMENT#${cleanTimestamp}#${random}`;
}

/**
 * Generates partition key for an event
 * Format: "ALERT#{stationId}#{alertId}"
 * @param stationId IMGW station ID
 * @param alertId Alert identifier (extracted from alertSk or generated)
 * @returns Partition key string
 */
export function generatePartitionKey(stationId: string, alertId: string): string {
  return `ALERT#${stationId}#${alertId}`;
}

/**
 * Extracts alert ID from alert sort key
 * Alert sk format: "{stationId}#{alertId}" (e.g., "149200090#default")
 * @param alertSk Alert sort key
 * @returns Alert ID
 */
export function extractAlertId(alertSk: string): string {
  const parts = alertSk.split('#');
  return parts.length > 1 ? parts[1] : 'default';
}

/**
 * Writes an event to the WaterAlertEvents table
 * @param event Event data to write
 * @param options Logger configuration
 */
export async function writeEvent(
  event: Omit<AlertEvent, 'pk' | 'sk'>,
  options: EventLoggerOptions
): Promise<void> {
  const client =
    options.dynamoClient ||
    DynamoDBDocumentClient.from(new DynamoDBClient({}));

  // Generate keys
  const alertId = event.alertSk ? extractAlertId(event.alertSk) : 'default';
  const pk = generatePartitionKey(event.stationId, alertId);
  const sk = generateSortKey(event.measurementTimeIso);

  // Calculate TTL if specified
  let ttlEpochSeconds: number | undefined;
  if (options.ttlDays) {
    const ttlDate = new Date();
    ttlDate.setDate(ttlDate.getDate() + options.ttlDays);
    ttlEpochSeconds = Math.floor(ttlDate.getTime() / 1000);
  }

  const item: AlertEvent = {
    pk,
    sk,
    stationId: event.stationId,
    alertSk: event.alertSk,
    level: event.level,
    measurementTimeRaw: event.measurementTimeRaw,
    measurementTimeIso: event.measurementTimeIso,
    matched: event.matched,
    attemptedAt: event.attemptedAt,
    sentAt: event.sentAt,
    status: event.status,
    error: event.error,
    telegramMessageId: event.telegramMessageId,
    ...(ttlEpochSeconds && { ttlEpochSeconds }),
  };

  await client.send(
    new PutCommand({
      TableName: options.tableName,
      Item: item,
    })
  );
}

/**
 * Creates an event for a successful send
 * @param alert Alert configuration
 * @param measurement Water level measurement
 * @param telegramMessageId Telegram message ID
 * @param alertSk Alert sort key (e.g., "149200090#default")
 * @returns Event data ready to be written
 */
export function createSentEvent(
  alert: AlertConfig,
  measurement: ImgwMeasurement,
  telegramMessageId: number,
  alertSk: string
): Omit<AlertEvent, 'pk' | 'sk'> {
  const now = new Date().toISOString();
  return {
    stationId: alert.stationId,
    alertSk,
    level: measurement.level,
    measurementTimeRaw: measurement.measurementTime,
    measurementTimeIso: measurement.measurementTime,
    matched: true,
    attemptedAt: now,
    sentAt: now,
    status: 'SENT',
    telegramMessageId,
  };
}

/**
 * Creates an event for a failed send
 * @param alert Alert configuration
 * @param measurement Water level measurement
 * @param error Error message or object
 * @param alertSk Alert sort key (e.g., "149200090#default")
 * @returns Event data ready to be written
 */
export function createFailedEvent(
  alert: AlertConfig,
  measurement: ImgwMeasurement,
  error: string | Error,
  alertSk: string
): Omit<AlertEvent, 'pk' | 'sk'> {
  const now = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.message : error;
  return {
    stationId: alert.stationId,
    alertSk,
    level: measurement.level,
    measurementTimeRaw: measurement.measurementTime,
    measurementTimeIso: measurement.measurementTime,
    matched: true,
    attemptedAt: now,
    status: 'FAILED',
    error: errorMessage,
  };
}

/**
 * Creates an event for a matched alert that was skipped (optional, for observability)
 * @param alert Alert configuration
 * @param measurement Water level measurement
 * @param alertSk Alert sort key (e.g., "149200090#default")
 * @returns Event data ready to be written
 */
export function createSkippedEvent(
  alert: AlertConfig,
  measurement: ImgwMeasurement,
  alertSk: string
): Omit<AlertEvent, 'pk' | 'sk'> {
  const now = new Date().toISOString();
  return {
    stationId: alert.stationId,
    alertSk,
    level: measurement.level,
    measurementTimeRaw: measurement.measurementTime,
    measurementTimeIso: measurement.measurementTime,
    matched: true,
    attemptedAt: now,
    status: 'SKIPPED',
  };
}
