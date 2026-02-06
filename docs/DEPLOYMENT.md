# Deployment Guide

This guide walks you through deploying the IMGW Alerts infrastructure to AWS.

## Prerequisites

1. **AWS Account** - You should have already created and configured this
2. **AWS CLI configured** - With credentials for your AWS account
3. **CDK Bootstrapped** - If you haven't already:
   ```bash
   cd infra
   npx cdk bootstrap aws://ACCOUNT-ID/REGION --profile personal
   ```

## Deployment Steps

### 1. Set Up Telegram Bot Token

Before deploying, you need to create the SSM parameter for your Telegram bot token:

```bash
aws ssm put-parameter \
  --name /water-alerts/telegram/bot-token \
  --value "YOUR_BOT_TOKEN_HERE" \
  --type SecureString \
  --profile personal
```

**To get your bot token:**
1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Use `/newbot` to create a bot (or `/token` to get existing bot token)
3. Copy the token and use it in the command above

### 2. Deploy the Stack

```bash
cd infra
AWS_PROFILE=personal npx cdk deploy
```

**First deployment will create:**
- DynamoDB tables (`WaterAlerts`, `WaterAlertEvents`)
- SSM Parameter (placeholder - you already created the actual one)
- Lambda function (`imgw-alerts-worker`)
- EventBridge Scheduler (daily at 19:00 Europe/Warsaw)
- CloudWatch Log Group
- CloudWatch Alarm (optional SNS if email provided)

**Optional: Enable email notifications for alarms:**
```bash
AWS_PROFILE=personal npx cdk deploy --context alarmEmail=your-email@example.com
```

**Note:** The first time you add an email subscription, AWS will send a confirmation email. You must click the confirmation link before alarms can send notifications.

### 3. Create Your First Alert

After deployment, create an alert in DynamoDB. See [DYNAMODB.md](./DYNAMODB.md) for detailed instructions.

**Quick example via AWS CLI:**
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
    "telegramChatId": {"S": "YOUR_CHAT_ID"},
    "createdAt": {"S": "2026-02-06T10:30:00.000Z"},
    "updatedAt": {"S": "2026-02-06T10:30:00.000Z"}
  }' \
  --profile personal
```

**To get your Telegram chat ID:**
1. Start a conversation with your bot
2. Send any message
3. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Look for `"chat":{"id":123456789}` in the response

### 4. Test the Lambda (Optional)

You can manually invoke the Lambda to test it:

```bash
aws lambda invoke \
  --function-name imgw-alerts-worker \
  --profile personal \
  response.json

cat response.json
```

Check CloudWatch Logs for detailed output:
```bash
aws logs tail /aws/lambda/imgw-alerts-worker --follow --profile personal
```

### 5. Verify Scheduler

The EventBridge Scheduler runs daily at 19:00 Europe/Warsaw time. To test immediately, you can:

1. **Temporarily change schedule** (for testing):
   ```bash
   cd infra
   AWS_PROFILE=personal npx cdk deploy --context schedule="rate(5 minutes)"
   ```
   This will run every 5 minutes. **Remember to change it back!**

2. **Manually trigger** via AWS Console:
   - Go to EventBridge → Schedules
   - Find `ImgwAlertsStack-dev-WorkerSchedule-XXXXX`
   - Click "Run schedule"

## Post-Deployment Checklist

- [ ] SSM parameter `/water-alerts/telegram/bot-token` exists with your bot token
- [ ] DynamoDB table `WaterAlerts` has at least one alert configured
- [ ] Alert has `enabled: true`
- [ ] Telegram chat ID is correct
- [ ] EventBridge Scheduler is enabled
- [ ] CloudWatch Log Group exists and has logs
- [ ] (Optional) SNS topic created and email confirmed

## Troubleshooting

### Lambda Function Errors

Check CloudWatch Logs:
```bash
aws logs tail /aws/lambda/imgw-alerts-worker --follow --profile personal
```

Common issues:
- **SSM parameter not found**: Make sure you created the parameter with the exact name `/water-alerts/telegram/bot-token`
- **DynamoDB access denied**: Check IAM permissions for Lambda
- **Telegram API errors**: Verify bot token and chat ID are correct

### Scheduler Not Running

1. Check EventBridge Scheduler in AWS Console
2. Verify schedule is enabled
3. Check schedule expression (should be `cron(0 19 * * ? *)` with timezone `Europe/Warsaw`)
4. Check Lambda function logs for execution history

### No Notifications Received

1. Verify alert is `enabled: true` in DynamoDB
2. Check if water level is within `minLevel` and `maxLevel` range
3. Verify Telegram chat ID is correct
4. Check CloudWatch Logs for errors
5. Test Telegram bot manually: send a message to your bot

## Updating the Stack

After making code changes:

```bash
# Build TypeScript
npm run build

# Deploy updated stack
cd infra
AWS_PROFILE=personal npx cdk deploy
```

## Destroying the Stack

**Warning:** This will delete all resources including DynamoDB tables (unless they have `RemovalPolicy.RETAIN`).

```bash
cd infra
AWS_PROFILE=personal npx cdk destroy
```

Note: DynamoDB tables are set to `RETAIN` by default, so they will remain after stack deletion. You can manually delete them if needed.
