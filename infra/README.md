# IMGW Alerts - Infrastructure

AWS CDK infrastructure code for the IMGW water level alerts system.

## Prerequisites

- AWS CLI configured with credentials
- Node.js 20+ (CDK is used via `npx`, no global install needed)

## Setup

```bash
# Install dependencies
npm ci

# Build TypeScript
npm run build
```

## Bootstrap CDK

Before deploying any stacks, you need to bootstrap CDK in your AWS account and region:

```bash
# Bootstrap with default region (eu-central-1)
cdk bootstrap

# Or specify region explicitly
cdk bootstrap --region eu-central-1

# Or use a specific AWS profile
cdk bootstrap --profile personal
```

## Deploy

```bash
# Deploy the stack
npm run deploy

# Or use CDK directly via npx
npx cdk deploy

# Deploy with specific environment
cdk deploy --context env=prod

# Deploy with specific region
cdk deploy --context region=eu-central-1
```

## Other Commands

```bash
# Synthesize CloudFormation template
npm run synth

# View differences
npm run diff

# Destroy stack
npm run destroy
```

## Configuration

- **Default Region:** `eu-central-1` (can be overridden via context or environment variable)
- **Default Environment:** `dev` (can be overridden via `--context env=prod`)
- **Standard Tags:** All resources are tagged with `Project=imgw-alerts` and `Environment={env}`

## Context Variables

You can pass context variables to CDK:

```bash
cdk deploy --context env=prod --context region=us-east-1
```

Or set environment variables:

```bash
export CDK_DEFAULT_REGION=eu-central-1
export CDK_DEFAULT_ACCOUNT=123456789012
cdk deploy
```
