# IMGW Water Level Alerts

A serverless AWS application that monitors Polish IMGW water level stations and sends Telegram notifications when readings fall within configured alert ranges.

## Overview

This project periodically checks water levels (`stan_wody`) reported by the Polish IMGW public API for configured hydro stations and sends Telegram notifications when readings fall within an alert's configured range.

**Current Status:** Phase 1 - Initial Implementation
- Single user, no UI
- Daily scheduled checks (evening, Europe/Warsaw timezone)
- Alert configuration managed directly in DynamoDB

## Architecture

- **EventBridge Scheduler** - Daily execution trigger
- **AWS Lambda** - Check logic and notification sending
- **DynamoDB** - Alert configurations and event history
- **SSM Parameter Store** - Secure storage for Telegram bot token
- **Telegram Bot API** - Notification channel

For detailed architecture and design decisions, see [docs/DESIGN.md](./docs/DESIGN.md).

For instructions on managing alert configurations in DynamoDB, see [docs/DYNAMODB.md](./docs/DYNAMODB.md).

For step-by-step deployment instructions, see [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

## Project Structure

```
.
├── docs/              # Design documentation
│   ├── DESIGN.md      # Architecture and design decisions
│   └── DYNAMODB.md    # DynamoDB configuration guide
├── infra/             # AWS CDK infrastructure code
├── services/          # Application code
│   └── worker/        # Lambda function code
└── tests/             # Test files
```

## Prerequisites

- Node.js 20+
- npm or yarn
- AWS account (personal or work)
- AWS CLI installed and configured
- AWS CDK (runs via `npx`, no global install needed)

## AWS Setup

### 1. Create AWS Account

If you don't have an AWS account:
1. Go to https://aws.amazon.com/ and create an account
2. Complete verification (phone, payment method)
3. **Important:** Set up billing alerts to avoid unexpected charges (see [AWS Billing Dashboard](https://console.aws.amazon.com/billing/))

### 2. Install and Configure AWS CLI

**Install AWS CLI:**
```bash
# macOS (using Homebrew)
brew install awscli

# Or download from: https://aws.amazon.com/cli/
```

**Configure AWS credentials:**
```bash
# Configure default profile
aws configure

# Or configure a named profile (recommended if you have multiple AWS accounts)
aws configure --profile personal
```

You'll need:
- **AWS Access Key ID** - Get from AWS Console → Security credentials → Access keys
- **AWS Secret Access Key** - Created when you generate an access key
- **Default region** - `eu-central-1` (recommended for this project)
- **Default output format** - `json`

**Verify configuration:**
```bash
aws sts get-caller-identity --profile personal
# Should show your account ID, user ARN, etc.
```

### 3. Bootstrap CDK (First Time Only)

Before deploying, bootstrap CDK in your AWS account and region:

```bash
cd infra
npm install  # First time only, generates package-lock.json
npm run build

# Bootstrap with your profile
AWS_PROFILE=personal npm run bootstrap

# Or with explicit account/region
AWS_PROFILE=personal npx cdk bootstrap aws://YOUR_ACCOUNT_ID/eu-central-1
```

This is a one-time setup per AWS account/region combination.

## Development

### Setup

```bash
# Install dependencies
npm ci

# Build TypeScript
npm run build
```

### Available Scripts

- `npm run build` - Compile TypeScript
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run test` - Run tests
- `npm run watch` - Watch mode for development

### Infrastructure

CDK infrastructure is located in `infra/`. See [infra/README.md](./infra/README.md) for detailed CDK commands.

**Deploy stack:**
```bash
cd infra
AWS_PROFILE=personal npm run deploy
```

**Other useful commands:**
```bash
cd infra
npm run synth    # Generate CloudFormation template
npm run diff     # See what will change
npm run destroy  # Remove the stack
```

## Observability

### CloudWatch Logs

The Lambda function uses structured JSON logging. Each log entry includes:
- `logLevel`: `INFO` or `ERROR`
- `message`: Human-readable message
- `timestamp`: ISO timestamp
- Alert context: `stationId`, `level`, `matched`, `status`, etc.

**Secrets are automatically redacted** - any field containing "token", "secret", "password", etc. will be logged as `[REDACTED]`.

### CloudWatch Alarms

A CloudWatch alarm monitors Lambda errors:
- **Alarm Name**: `imgw-alerts-worker-errors`
- **Metric**: Lambda errors (sum over 1 day)
- **Threshold**: > 0 errors
- **Action**: Optional SNS email notification (if configured)

**To enable email notifications**, deploy with:
```bash
cd infra
npx cdk deploy --context alarmEmail=your-email@example.com
```

The first time you subscribe an email to SNS, AWS will send a confirmation email. Click the confirmation link before the alarm can send notifications.

## Security

**Important:** Secrets (Telegram bot token) are stored in AWS SSM Parameter Store (SecureString) and are never committed to this repository.

## License

Private project.
