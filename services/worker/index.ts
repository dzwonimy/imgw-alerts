import { Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { fetchStationData } from './imgw-client';
import { filterEnabledAlerts, evaluateAlert, AlertConfig } from './alert-evaluator';
import { sendMessage } from './telegram-client';
import {
  writeEvent,
  createSentEvent,
  createFailedEvent,
  createSkippedEvent,
} from './event-logger';
import { logAlertEvent, logAlertError, logInfo } from './logger';

/**
 * Lambda handler for IMGW water level alerts
 * 
 * Workflow:
 * 1. Query all alerts from DynamoDB
 * 2. Filter to enabled alerts only
 * 3. For each alert:
 *    - Fetch water level data from IMGW API
 *    - Check if level is within alert range
 *    - If matched: send Telegram notification
 *    - Log event (SENT/FAILED/SKIPPED) to DynamoDB
 */
export const handler = async (_event: unknown, _context: Context): Promise<void> => {
  const alertsTableName = process.env.ALERTS_TABLE_NAME;
  const eventsTableName = process.env.EVENTS_TABLE_NAME;
  const telegramTokenParam = process.env.TELEGRAM_TOKEN_PARAM;
  const imgwBaseUrl = process.env.IMGW_BASE_URL || 'https://danepubliczne.imgw.pl/api/data/hydro/id/';

  if (!alertsTableName || !eventsTableName || !telegramTokenParam) {
    throw new Error('Missing required environment variables');
  }

  // Initialize DynamoDB client
  const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  try {
    logInfo('Worker started', {
      alertsTableName,
      eventsTableName,
      telegramTokenParam,
    });

    // Step 1: Query all alerts from DynamoDB
    const queryResponse = await dynamoClient.send(
      new QueryCommand({
        TableName: alertsTableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': 'ALERT',
        },
      })
    );

    const allAlerts = (queryResponse.Items || []) as Array<AlertConfig & { pk: string; sk: string }>;
    logInfo(`Found ${allAlerts.length} total alerts`);

    // Step 2: Filter to only enabled alerts
    const enabledAlerts = filterEnabledAlerts(allAlerts);
    logInfo(`Processing ${enabledAlerts.length} enabled alerts`);

    if (enabledAlerts.length === 0) {
      logInfo('No enabled alerts to process');
      return;
    }

    // Step 3: Process each alert
    for (const alert of enabledAlerts) {
      const alertSk = (alert as AlertConfig & { sk: string }).sk; // Store original sk for event logging

      try {
        logInfo(`Processing alert for station ${alert.stationId}`, {
          alertSk,
          stationId: alert.stationId,
          name: alert.name,
        });

        // Step 3a: Fetch water level data from IMGW
        const measurement = await fetchStationData(alert.stationId, {
          baseUrl: imgwBaseUrl,
          timeout: 10000,
        });

        if (!measurement) {
          logAlertEvent('No measurement data available', {
            stationId: alert.stationId,
            alertSk,
            status: 'SKIPPED',
          });

          // Log skipped event (no measurement available)
          // Use placeholder measurement for event logging
          const placeholderMeasurement = {
            level: -1,
            measurementTime: new Date().toISOString(),
            rawData: null,
          };
          await writeEvent(
            createSkippedEvent(alert, placeholderMeasurement, alertSk),
            { tableName: eventsTableName, dynamoClient: dynamoClient }
          );
          continue;
        }

        logAlertEvent('Measurement fetched', {
          stationId: alert.stationId,
          alertSk,
          level: measurement.level,
        });

        // Step 3b: Check if level is within alert range
        const isMatched = evaluateAlert(alert, {
          level: measurement.level,
          measurementTime: measurement.measurementTime,
        });

        if (!isMatched) {
          // Level not in range - log as skipped
          logAlertEvent('Alert not matched (level out of range)', {
            stationId: alert.stationId,
            alertSk,
            level: measurement.level,
            matched: false,
            status: 'SKIPPED',
          });

          await writeEvent(
            createSkippedEvent(alert, measurement, alertSk),
            { tableName: eventsTableName, dynamoClient: dynamoClient }
          );
          continue;
        }

        // Step 3c: Level is in range - send Telegram notification
        logAlertEvent('Alert matched - sending notification', {
          stationId: alert.stationId,
          alertSk,
          level: measurement.level,
          matched: true,
          status: 'SENT',
        });

        try {
          const messageId = await sendMessage(
            {
              text: formatTelegramMessage(alert, measurement),
              chatId: alert.telegramChatId,
            },
            {
              ssmParameterName: telegramTokenParam,
            }
          );

          logAlertEvent('Notification sent successfully', {
            stationId: alert.stationId,
            alertSk,
            level: measurement.level,
            matched: true,
            status: 'SENT',
            telegramMessageId: messageId,
          });

          // Log successful event
          await writeEvent(
            createSentEvent(alert, measurement, messageId, alertSk),
            { tableName: eventsTableName, dynamoClient: dynamoClient }
          );
        } catch (error: unknown) {
          // Failed to send notification
          const errorMessage = error instanceof Error ? error.message : String(error);
          const sendError = error instanceof Error ? error : new Error(String(error));
          logAlertError('Failed to send notification', sendError, {
            stationId: alert.stationId,
            alertSk,
            level: measurement.level,
            matched: true,
            status: 'FAILED',
            error: errorMessage,
          });

          // Log failed event
          await writeEvent(
            createFailedEvent(alert, measurement, sendError, alertSk),
            { tableName: eventsTableName, dynamoClient: dynamoClient }
          );
        }
      } catch (error: unknown) {
        // Error processing this alert (e.g., IMGW API failure)
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorForEvent = error instanceof Error ? error : new Error(String(error));
        logAlertError('Error processing alert', errorForEvent, {
          stationId: alert.stationId,
          alertSk,
          status: 'ERROR',
          error: errorMessage,
        });

        // Log failed event (no measurement available)
        // Create a placeholder measurement for the event
        const placeholderMeasurement = {
          level: -1,
          measurementTime: new Date().toISOString(),
          rawData: null,
        };
        await writeEvent(
          createFailedEvent(alert, placeholderMeasurement, errorForEvent, alertSk),
          { tableName: eventsTableName, dynamoClient: dynamoClient }
        );
      }
    }

    logInfo('Worker completed successfully');
  } catch (error: unknown) {
    const fatalError = error instanceof Error ? error : new Error(String(error));
    logAlertError('Fatal error in worker', fatalError);
    throw fatalError; // Let Lambda retry if configured
  }
};

/**
 * Formats a Telegram message for a matched alert
 */
function formatTelegramMessage(
  alert: AlertConfig,
  measurement: { level: number; measurementTime: string }
): string {
  const stationName = alert.name || `Station ${alert.stationId}`;
  const level = Math.round(measurement.level); // Round to integer
  const time = new Date(measurement.measurementTime).toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return (
    `🌊 <b>Alert: ${stationName}</b>\n\n` +
    `Poziom wody: <b>${level} cm</b>\n` +
    `Zakres alertu: ${alert.minLevel} - ${alert.maxLevel} cm\n` +
    `Czas pomiaru: ${time}`
  );
}
