# IMGW Water Level Alerts - Design Document

**Version:** 1.0  
**Last Updated:** 2026-02-06  
**Status:** Phase 1 - Initial Implementation

> **Note:** This document describes the architecture and design decisions for the IMGW water level alerting system. Secrets (Telegram bot token) are stored in AWS SSM Parameter Store (SecureString) or Secrets Manager and are never committed to this repository.

---

## 1. Overview

This project periodically checks water levels (stan_wody) reported by the Polish IMGW public API for configured hydro stations and sends Telegram notifications when readings fall within an alert's configured range.

**Initial scope:**
- Single user (you)
- No UI (alert configuration edited directly in DynamoDB)
- One daily check (evening, Europe/Warsaw)
- Notify only when in range
- AWS-native implementation using managed services and Infrastructure as Code (AWS CDK, TypeScript)

**Future scope:**
- UI for managing alerts
- Authentication/authorization

## 2. Goals and Non-Goals

### Goals (Phase 1)
- Store alert configurations in a database (DynamoDB).
- Run a scheduled check daily at a fixed time.
- For each enabled alert:
  - fetch latest reading from IMGW API
  - evaluate range match
  - send Telegram message if in range
- Keep an event/audit log of notifications sent (for debugging and history).
- Fully reproducible infrastructure using AWS CDK.

### Non-Goals (Phase 1)
- No web UI, no user accounts.
- No deduplication/cooldown logic (you explicitly want daily notifications while in range).
- No high-frequency polling (daily only).
- No alert "state machine" (enter/exit range) yet.

## 3. Requirements

### Functional Requirements
- System must support creating/updating/deleting alert config records in DynamoDB.
- System must run daily on a schedule (Europe/Warsaw timezone).
- System must fetch station data from:
  - `https://danepubliczne.imgw.pl/api/data/hydro/id/{stationId}`
- System must extract and parse `stan_wody` as a number.
- If `minLevel <= stan_wody <= maxLevel`, send a Telegram message to a configured chat.
- System must write a notification event record for each attempted send (success/failure).

### Non-Functional Requirements
- **Reliability:** job should complete even if one station fails (per-alert error isolation).
- **Security:** Telegram token stored securely (SSM SecureString or Secrets Manager).
- **Maintainability:** clear separation between "config", "check", "notify", and "log".
- **Cost:** minimal, serverless-first.

## 4. High-Level Architecture

### Services
- **EventBridge Scheduler:** triggers daily execution.
- **AWS Lambda (Node.js / TypeScript):** performs checks and sends notifications.
- **DynamoDB:**
  - `WaterAlerts` table stores alert configurations.
  - `WaterAlertEvents` table stores notification attempts/history.
- **SSM Parameter Store (SecureString):** stores Telegram bot token.
- **Telegram Bot API:** outbound notification channel.
- **IMGW Public API:** data source.

### Data Flow
1. Scheduler → invokes Lambda.
2. Lambda → reads enabled alerts from `WaterAlerts`.
3. For each alert → fetches IMGW data → evaluates threshold.
4. If matched → send Telegram message.
5. Lambda → writes event row to `WaterAlertEvents` for each send attempt.

## 5. Data Design (DynamoDB)

### 5.1 WaterAlerts table (Configurations)

**Primary key**
- Partition key: `pk` (string)
- Sort key: `sk` (string)

**Key scheme**
- `pk = "ALERT"`
- `sk = "{stationId}#{alertId}"` (e.g., `149200090#default`)

This enables:
- Fetch all alerts with a single `Query(pk="ALERT")`
- Uniquely identify alerts by composite key
- Easy extension to multiple users later (`pk = "USER#{userId}"`)

**Attributes**
- `stationId` (string) – IMGW station id
- `minLevel` (number)
- `maxLevel` (number)
- `enabled` (boolean)
- `telegramChatId` (string or number; store as string to avoid JS integer issues)
- `name` (string, optional) – human-friendly label
- `createdAt` (string ISO)
- `updatedAt` (string ISO)

**Example item**
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

### 5.2 WaterAlertEvents table (History / Audit Log)

**Primary key**
- Partition key: `pk` (string)
- Sort key: `sk` (string)

**Key scheme**
- `pk = "ALERT#{stationId}#{alertId}"` (must match alert identity)
- `sk = "MEASUREMENT#{measurementTimestampIso}#{ulid}"` (or just `{timestamp}#{random}`)

Why include a random/ULID suffix:
- if IMGW repeats measurement timestamps, you still get unique items
- allows multiple sends for same measurement (rare, but useful in debugging)

**Attributes**
- `stationId`
- `alertSk` (original alert sk, optional)
- `level` (number)
- `measurementTimeRaw` (string from IMGW, optional)
- `measurementTimeIso` (string ISO, optional if you parse)
- `matched` (boolean)
- `attemptedAt` (ISO)
- `sentAt` (ISO, if sent)
- `status` (`SENT` | `FAILED` | `SKIPPED`)
- `error` (string, optional)
- `telegramMessageId` (optional if captured)

Note: Since you only log on send attempt, you can omit `SKIPPED`. But keeping `matched` and `SKIPPED` becomes useful later if you want full run observability.

## 6. Scheduling

EventBridge Scheduler is used (not a "rule" cron).

- **Schedule:** daily at fixed time, e.g. 19:00 in Europe/Warsaw.
- **Scheduler invokes Lambda directly.**

**Considerations:**
- Retry policy: enable scheduler retry on transient failure (or rely on Lambda retries if async invoke is used; direct invoke typically returns success/failure).

## 7. Lambda Design

### 7.1 Runtime and dependencies
- Node.js 20
- TypeScript compiled output
- HTTP client: built-in `fetch` (Node 18+ has it; Node 20 OK)
- AWS SDK v3 (available in Lambda runtime; but pin dependencies in package for predictable builds)

### 7.2 Configuration
Lambda environment variables:
- `ALERTS_TABLE_NAME`
- `EVENTS_TABLE_NAME`
- `TELEGRAM_TOKEN_PARAM` (SSM parameter name)
- Optional: `IMGW_BASE_URL` (default to `https://danepubliczne.imgw.pl/api/data/hydro/id/`)

### 7.3 Permissions (IAM)
Lambda execution role needs:
- `dynamodb:Query` on `WaterAlerts`
- `dynamodb:PutItem` on `WaterAlertEvents`
- `ssm:GetParameter` on the Telegram token parameter (with decryption)
- `logs:*` for CloudWatch logs

### 7.4 Core algorithm

For each run:
1. Load Telegram token from SSM (can be cached across invocations in a module-level variable).
2. Query all alert configs: `pk = "ALERT"`.
3. Filter enabled alerts (`enabled === true`).
4. For each enabled alert:
   - fetch station data from IMGW endpoint
   - parse JSON array, take first element
   - parse `stan_wody` → number
   - if parsing fails → write `FAILED` event (optional) and continue
   - check match: `minLevel <= level <= maxLevel`
   - if not matched → do nothing (Phase 1 behavior)
   - if matched:
     - send Telegram message to `telegramChatId`
     - write event row (`SENT`/`FAILED`)

**Error isolation:**
- a failure in one alert must not stop processing of the others.

## 8. Message Format (Telegram)

Example message:
```
Water level alert matched
Station: Dobczyce (Raba)
Level: 245 cm
Measurement time: 2026-02-06 10:00:00
Range: 235–260
```

Keep it informative but short. Include `stationId` for debugging.

## 9. Operational Concerns

### Logging
- Log one line per alert processed: `stationId`, `level`, `matched`, `send status`.
- Log full error details on failures (but never log Telegram token).

### Retries
- Telegram send failures: in Phase 1 you can do a single attempt and log failure.
- Later: implement retry with exponential backoff for transient errors.

### Observability
CloudWatch metrics later:
- number of alerts processed
- number matched
- number sent / failed

### Cost
- DynamoDB: tiny
- Lambda: tiny (1 run/day)
- Scheduler: small monthly cost, still minimal overall

## 10. Security

- Telegram bot token stored in SSM Parameter Store SecureString (or Secrets Manager).
- Lambda gets token via IAM permission; token never hardcoded.
- DynamoDB tables: least-privilege IAM.
- No public endpoints exposed (no UI/API in Phase 1).

## 11. Deployment Plan (CDK)

CDK stack will provision:
- DynamoDB `WaterAlerts` table (on-demand billing)
- DynamoDB `WaterAlertEvents` table (on-demand billing)
- SSM SecureString parameter placeholder name (you can create it manually or via CDK; many prefer manual for secrets)
- Lambda function (bundled from TypeScript)
- EventBridge Scheduler schedule targeting Lambda
- IAM policies for Lambda role

**Post-deploy manual steps:**
1. Create Telegram bot token in SSM parameter.
2. Insert initial alert config item in DynamoDB.
3. Run a one-off test invocation of Lambda.
4. Confirm message arrives and event is written.

## 12. Testing Strategy

### Unit tests (optional early, recommended)
- parsing IMGW response → numeric level
- range evaluation
- Telegram message formatting

### Integration tests
- Run Lambda locally (or via `sam local`) with mocks for:
  - DynamoDB
  - IMGW endpoint
  - Telegram API

### Live smoke test
- Temporarily set range to include current value to force a notification.
- Verify DynamoDB event record and Telegram message.

## 13. Future Enhancements

### UI + Auth
- Add a small admin UI/API (ECS Fargate or Lambda+API Gateway).
- Authentication options:
  - Google OAuth allowlist (only your email) via Cognito or an identity-aware proxy
  - Cloudflare Access in front of the UI
- Store alerts per user (change key schema to `pk = "USER#{userId}"`).
