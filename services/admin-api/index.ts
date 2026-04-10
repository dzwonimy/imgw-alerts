import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { fetchStationData } from '../worker/imgw-client';

const PK_ALERT = 'ALERT';
const UI_ALERT_SUFFIX = 'default';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  };
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizePath(path: string): string {
  if (!path || path === '') return '/';
  const p = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  return p;
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const tableName = process.env.ALERTS_TABLE_NAME;
  const imgwBaseUrl = process.env.IMGW_BASE_URL || 'https://danepubliczne.imgw.pl/api/data/hydro/id/';
  const defaultTelegramChatId = process.env.DEFAULT_TELEGRAM_CHAT_ID || '';

  if (!tableName) {
    return json(500, { error: 'ALERTS_TABLE_NAME is not set' });
  }

  const method = event.requestContext.http.method;
  const path = normalizePath(event.rawPath || '/');

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (path !== '/alerts') {
    return json(404, { error: 'Not found' });
  }

  try {
    if (method === 'GET') {
      const query = await docClient.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': PK_ALERT },
        })
      );

      const items = (query.Items || []) as Array<Record<string, unknown>>;
      const stationIds = [...new Set(items.map((i) => String(i.stationId || '')).filter(Boolean))];

      const levelByStation = new Map<
        string,
        {
          level: number;
          measurementTime: string;
          flowM3s: number | null;
          waterTempC: number | null;
        } | null
      >();
      await Promise.all(
        stationIds.map(async (sid) => {
          try {
            const m = await fetchStationData(sid, { baseUrl: imgwBaseUrl, timeout: 10000 });
            levelByStation.set(
              sid,
              m
                ? {
                    level: m.level,
                    measurementTime: m.measurementTime,
                    flowM3s: m.flowM3s,
                    waterTempC: m.waterTempC,
                  }
                : null
            );
          } catch {
            levelByStation.set(sid, null);
          }
        })
      );

      const alerts = items.map((item) => {
        const stationId = String(item.stationId ?? '');
        const live = levelByStation.get(stationId) ?? null;
        return {
          sk: String(item.sk ?? ''),
          stationId,
          name: item.name != null ? String(item.name) : '',
          minLevel: item.minLevel,
          maxLevel: item.maxLevel,
          enabled: item.enabled === true,
          currentLevel: live?.level ?? null,
          currentLevelAt: live?.measurementTime ?? null,
          currentFlowM3s: live?.flowM3s ?? null,
          currentWaterTempC: live?.waterTempC ?? null,
        };
      });

      return json(200, { alerts });
    }

    if (method === 'POST') {
      const body = parseJsonBody(event.body);
      if (!body) return json(400, { error: 'Invalid JSON body' });

      const stationId = String(body.stationId ?? '').trim();
      const name = String(body.name ?? '');
      const minLevel = body.minLevel;
      const maxLevel = body.maxLevel;

      if (!stationId) {
        return json(400, { error: 'stationId is required' });
      }

      const sk = `${stationId}#${UI_ALERT_SUFFIX}`;
      const now = new Date().toISOString();

      if (!defaultTelegramChatId) {
        return json(500, { error: 'DEFAULT_TELEGRAM_CHAT_ID is not configured' });
      }

      try {
        await docClient.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              pk: PK_ALERT,
              sk,
              stationId,
              name,
              minLevel,
              maxLevel,
              enabled: true,
              telegramChatId: defaultTelegramChatId,
              createdAt: now,
              updatedAt: now,
            },
            ConditionExpression: 'attribute_not_exists(sk)',
          })
        );
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) {
          return json(409, { error: 'Alert for this station already exists' });
        }
        throw e;
      }

      return json(201, { sk, stationId, name, minLevel, maxLevel, enabled: true });
    }

    if (method === 'PUT') {
      const body = parseJsonBody(event.body);
      if (!body) return json(400, { error: 'Invalid JSON body' });

      const sk = String(body.sk ?? '').trim();
      if (!sk) {
        return json(400, { error: 'sk is required' });
      }

      const name = body.name !== undefined ? String(body.name) : undefined;
      const minLevel = body.minLevel;
      const maxLevel = body.maxLevel;
      const enabled = body.enabled;

      const exprNames: Record<string, string> = {
        '#ua': 'updatedAt',
      };
      const exprValues: Record<string, unknown> = {
        ':ua': new Date().toISOString(),
      };
      const sets: string[] = ['#ua = :ua'];

      if (name !== undefined) {
        exprNames['#n'] = 'name';
        exprValues[':n'] = name;
        sets.push('#n = :n');
      }
      if (minLevel !== undefined) {
        exprNames['#min'] = 'minLevel';
        exprValues[':min'] = minLevel;
        sets.push('#min = :min');
      }
      if (maxLevel !== undefined) {
        exprNames['#max'] = 'maxLevel';
        exprValues[':max'] = maxLevel;
        sets.push('#max = :max');
      }
      if (enabled !== undefined) {
        exprNames['#en'] = 'enabled';
        exprValues[':en'] = Boolean(enabled);
        sets.push('#en = :en');
      }

      try {
        await docClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: PK_ALERT, sk },
            UpdateExpression: 'SET ' + sets.join(', '),
            ExpressionAttributeNames: exprNames,
            ExpressionAttributeValues: exprValues,
            ConditionExpression: 'attribute_exists(sk)',
          })
        );
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) {
          return json(404, { error: 'Alert not found' });
        }
        throw e;
      }

      return json(200, { ok: true, sk });
    }

    if (method === 'DELETE') {
      const body = parseJsonBody(event.body);
      if (!body) return json(400, { error: 'Invalid JSON body' });

      const sk = String(body.sk ?? '').trim();
      if (!sk) {
        return json(400, { error: 'sk is required' });
      }

      try {
        await docClient.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { pk: PK_ALERT, sk },
            ConditionExpression: 'attribute_exists(sk)',
          })
        );
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) {
          return json(404, { error: 'Alert not found' });
        }
        throw e;
      }

      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('admin-api error', err);
    return json(500, { error: message });
  }
};
