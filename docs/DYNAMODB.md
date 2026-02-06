# DynamoDB Configuration Guide

This document explains how to manage alert configurations in the `WaterAlerts` DynamoDB table.

## Table Structure

**Table Name:** `WaterAlerts`

**Primary Key:**
- Partition Key (`pk`): `"ALERT"` (string)
- Sort Key (`sk`): `"{stationId}#{alertId}"` (string)

## Key Conventions

### Partition Key (`pk`)
- Always set to `"ALERT"` for all alert configurations
- This allows querying all alerts with a single query: `pk = "ALERT"`

### Sort Key (`sk`)
- Format: `"{stationId}#{alertId}"`
- `stationId`: IMGW station ID (e.g., `"149200090"`)
- `alertId`: Unique identifier for the alert (e.g., `"default"`, `"high-water"`, `"low-water"`)
- Examples:
  - `"149200090#default"` - Default alert for station 149200090
  - `"149200090#high-water"` - High water alert for station 149200090
  - `"150190170#default"` - Default alert for station 150190170

**Why this structure?**
- Single query to get all alerts: `Query(pk="ALERT")`
- Easy to identify alerts by station and alert type
- Supports multiple alerts per station (different alertId values)
- Future-proof for multi-user scenarios (can change `pk` to `"USER#{userId}"` later)

## Alert Item Schema

### Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `pk` | string | Partition key, always `"ALERT"` | `"ALERT"` |
| `sk` | string | Sort key, `"{stationId}#{alertId}"` | `"149200090#default"` |
| `stationId` | string | IMGW station ID | `"149200090"` |
| `minLevel` | number | Minimum water level (cm) | `235` |
| `maxLevel` | number | Maximum water level (cm) | `260` |
| `enabled` | boolean | Whether alert is active | `true` |
| `telegramChatId` | string | Telegram chat ID to send notifications to | `"123456789"` |
| `createdAt` | string | ISO timestamp when alert was created | `"2026-02-06T10:30:00.000Z"` |
| `updatedAt` | string | ISO timestamp when alert was last updated | `"2026-02-06T10:30:00.000Z"` |

### Optional Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `name` | string | Human-friendly station name | `"Dobczyce (Raba)"` |

## Example Item

```json
{
  "pk": "ALERT",
  "sk": "149200090#default",
  "stationId": "149200090",
  "name": "Dobczyce (Raba)",
  "minLevel": 235,
  "maxLevel": 260,
  "enabled": true,
  "telegramChatId": "123456789",
  "createdAt": "2026-02-06T10:30:00.000Z",
  "updatedAt": "2026-02-06T10:30:00.000Z"
}
```

## Creating an Alert

### Via AWS Console

1. Go to **DynamoDB** → **Tables** → **WaterAlerts**
2. Click **Explore table items**
3. Click **Create item**
4. Add the following attributes:
   - `pk`: `"ALERT"` (String)
   - `sk`: `"{stationId}#{alertId}"` (String, e.g., `"149200090#default"`)
   - `stationId`: Your IMGW station ID (String)
   - `minLevel`: Minimum level in cm (Number)
   - `maxLevel`: Maximum level in cm (Number)
   - `enabled`: `true` (Boolean)
   - `telegramChatId`: Your Telegram chat ID (String)
   - `createdAt`: Current ISO timestamp (String)
   - `updatedAt`: Current ISO timestamp (String)
   - `name`: Optional station name (String)
5. Click **Create item**

### Via AWS CLI

```bash
aws dynamodb put-item \
  --table-name WaterAlerts \
  --item '{
    "pk": {"S": "ALERT"},
    "sk": {"S": "149200090#default"},
    "stationId": {"S": "149200090"},
    "name": {"S": "Dobczyce (Raba)"},
    "minLevel": {"N": "235"},
    "maxLevel": {"N": "260"},
    "enabled": {"BOOL": true},
    "telegramChatId": {"S": "123456789"},
    "createdAt": {"S": "2026-02-06T10:30:00.000Z"},
    "updatedAt": {"S": "2026-02-06T10:30:00.000Z"}
  }' \
  --profile personal
```

### Via AWS SDK (Node.js)

```javascript
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

await client.send(new PutCommand({
  TableName: 'WaterAlerts',
  Item: {
    pk: 'ALERT',
    sk: '149200090#default',
    stationId: '149200090',
    name: 'Dobczyce (Raba)',
    minLevel: 235,
    maxLevel: 260,
    enabled: true,
    telegramChatId: '123456789',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
}));
```

## Updating an Alert

### Enable/Disable Alert

```bash
aws dynamodb update-item \
  --table-name WaterAlerts \
  --key '{
    "pk": {"S": "ALERT"},
    "sk": {"S": "149200090#default"}
  }' \
  --update-expression "SET enabled = :enabled, updatedAt = :updatedAt" \
  --expression-attribute-values '{
    ":enabled": {"BOOL": false},
    ":updatedAt": {"S": "2026-02-06T15:00:00.000Z"}
  }' \
  --profile personal
```

### Update Level Range

```bash
aws dynamodb update-item \
  --table-name WaterAlerts \
  --key '{
    "pk": {"S": "ALERT"},
    "sk": {"S": "149200090#default"}
  }' \
  --update-expression "SET minLevel = :minLevel, maxLevel = :maxLevel, updatedAt = :updatedAt" \
  --expression-attribute-values '{
    ":minLevel": {"N": "240"},
    ":maxLevel": {"N": "265"},
    ":updatedAt": {"S": "2026-02-06T15:00:00.000Z"}
  }' \
  --profile personal
```

## Querying Alerts

### Get All Alerts

```bash
aws dynamodb query \
  --table-name WaterAlerts \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{
    ":pk": {"S": "ALERT"}
  }' \
  --profile personal
```

### Get Alerts for a Specific Station

```bash
aws dynamodb query \
  --table-name WaterAlerts \
  --key-condition-expression "pk = :pk AND begins_with(sk, :stationId)" \
  --expression-attribute-values '{
    ":pk": {"S": "ALERT"},
    ":stationId": {"S": "149200090#"}
  }' \
  --profile personal
```

## Finding IMGW Station IDs

IMGW station IDs can be found by:
1. Visiting the IMGW API documentation
2. Checking the station list at: `https://danepubliczne.imgw.pl/api/data/hydro/`
3. Using the station search functionality on the IMGW website

## Getting Your Telegram Chat ID

1. Start a conversation with your bot: `@imgw_hydro_alerts_bot`
2. Send any message to the bot
3. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Look for `"chat":{"id":123456789}` in the response
5. Use that number as your `telegramChatId`

## Best Practices

1. **Use descriptive alert IDs**: Instead of just `"default"`, use names like `"high-water"`, `"low-water"`, `"flood-warning"`
2. **Include station name**: Add the `name` field for easier identification
3. **Keep timestamps updated**: Update `updatedAt` whenever you modify an alert
4. **Test with disabled alerts**: Create alerts with `enabled: false` first, then enable after testing
5. **Use multiple alerts per station**: You can have different level ranges for the same station (e.g., `"149200090#low"` and `"149200090#high"`)
