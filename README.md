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

## Project Structure

```
.
├── docs/              # Design documentation
├── infra/             # AWS CDK infrastructure code
├── services/          # Application code
│   └── worker/        # Lambda function code
└── tests/             # Test files
```

## Prerequisites

- Node.js 20+
- npm or yarn
- AWS CLI configured
- AWS CDK CLI (`npm install -g aws-cdk`)

## Development

### Setup

```bash
npm ci
npm run build
```

### Available Scripts

- `npm run build` - Compile TypeScript
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run test` - Run tests
- `npm run watch` - Watch mode for development

### Infrastructure

CDK infrastructure is located in `infra/`. Deploy with:

```bash
cd infra
cdk deploy
```

## Security

**Important:** Secrets (Telegram bot token) are stored in AWS SSM Parameter Store (SecureString) and are never committed to this repository.

## License

Private project.
