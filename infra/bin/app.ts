#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ImgwAlertsStack } from '../lib/imgw-alerts-stack';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const env = app.node.tryGetContext('env') || 'dev';

// Get region from context, environment variable, or default to eu-central-1
const region =
  app.node.tryGetContext('region') ||
  process.env.CDK_DEFAULT_REGION ||
  'eu-central-1';

// Get account from context or environment variable
const account = app.node.tryGetContext('account') || process.env.CDK_DEFAULT_ACCOUNT;

// Build stack props - set env in the object literal since it's read-only
const stackProps: cdk.StackProps = {
  description: 'IMGW water level alerts infrastructure',
  tags: {
    Project: 'imgw-alerts',
    Environment: env,
  },
  // Set environment: if account is provided, use it; otherwise let CDK resolve from AWS credentials
  env: account
    ? {
        account,
        region,
      }
    : {
        region,
      },
};

new ImgwAlertsStack(app, `ImgwAlertsStack-${env}`, stackProps);
