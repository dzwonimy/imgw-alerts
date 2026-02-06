import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';

export interface ImgwAlertsStackProps extends cdk.StackProps {
  // Add custom props here if needed
}

export class ImgwAlertsStack extends cdk.Stack {
  public readonly waterAlertsTable: dynamodb.Table;
  public readonly waterAlertEventsTable: dynamodb.Table;
  public readonly telegramBotTokenParameterName: string;
  public readonly workerFunction: lambda.Function;
  public readonly scheduler: scheduler.Schedule;

  constructor(scope: Construct, id: string, props?: ImgwAlertsStackProps) {
    super(scope, id, props);

    // Apply standard tags to all resources in this stack
    cdk.Tags.of(this).add('Project', 'imgw-alerts');
    cdk.Tags.of(this).add('Environment', this.node.tryGetContext('env') || 'dev');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // DynamoDB table: WaterAlerts (Alert Configurations)
    // Schema: pk (partition key), sk (sort key)
    // Key scheme: pk = "ALERT", sk = "{stationId}#{alertId}"
    this.waterAlertsTable = new dynamodb.Table(this, 'WaterAlerts', {
      tableName: 'WaterAlerts',
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand billing
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true, // PITR enabled
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Retain table on stack deletion
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // DynamoDB table: WaterAlertEvents (Notification History / Audit Log)
    // Schema: pk (partition key), sk (sort key)
    // Key scheme: pk = "ALERT#{stationId}#{alertId}", sk = "MEASUREMENT#{measurementTimestampIso}#{ulid}"
    // TTL: Items with ttlEpochSeconds < current time will be automatically deleted
    this.waterAlertEventsTable = new dynamodb.Table(this, 'WaterAlertEvents', {
      tableName: 'WaterAlertEvents',
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand billing
      timeToLiveAttribute: 'ttlEpochSeconds', // TTL attribute for automatic cleanup
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Retain table on stack deletion
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Output table names for reference
    new cdk.CfnOutput(this, 'WaterAlertsTableName', {
      value: this.waterAlertsTable.tableName,
      description: 'Name of the WaterAlerts DynamoDB table',
      exportName: `${this.stackName}-WaterAlertsTableName`,
    });

    new cdk.CfnOutput(this, 'WaterAlertsTableArn', {
      value: this.waterAlertsTable.tableArn,
      description: 'ARN of the WaterAlerts DynamoDB table',
      exportName: `${this.stackName}-WaterAlertsTableArn`,
    });

    new cdk.CfnOutput(this, 'WaterAlertEventsTableName', {
      value: this.waterAlertEventsTable.tableName,
      description: 'Name of the WaterAlertEvents DynamoDB table',
      exportName: `${this.stackName}-WaterAlertEventsTableName`,
    });

    new cdk.CfnOutput(this, 'WaterAlertEventsTableArn', {
      value: this.waterAlertEventsTable.tableArn,
      description: 'ARN of the WaterAlertEvents DynamoDB table',
      exportName: `${this.stackName}-WaterAlertEventsTableArn`,
    });

    // SSM Parameter: Telegram Bot Token
    // Parameter name: /water-alerts/telegram/bot-token
    // Type: SecureString (encrypted at rest)
    // Note: Parameter is created manually (CloudFormation cannot create SecureString parameters)
    // Bot name: imgw_hydro_alerts_bot
    // To create: AWS Console → Systems Manager → Parameter Store → Create parameter
    // Or via CLI: aws ssm put-parameter --name /water-alerts/telegram/bot-token --value "YOUR_TOKEN" --type SecureString
    this.telegramBotTokenParameterName = '/water-alerts/telegram/bot-token';

    new cdk.CfnOutput(this, 'TelegramBotTokenParameterName', {
      value: this.telegramBotTokenParameterName,
      description: 'SSM Parameter name for Telegram bot token (update value manually)',
      exportName: `${this.stackName}-TelegramBotTokenParameterName`,
    });

    // Lambda function: IMGW Alerts Worker
    // Node.js 20 runtime, bundles TypeScript code from services/worker
    // Entry path is relative to project root (one level up from infra/)
    const projectRoot = path.join(__dirname, '../..');
    const workerEntryPath = path.join(projectRoot, 'services/worker/index.ts');
    const rootPackageLock = path.join(projectRoot, 'package-lock.json');
    
    this.workerFunction = new NodejsFunction(this, 'WorkerFunction', {
      functionName: 'imgw-alerts-worker',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: workerEntryPath,
      handler: 'handler',
      environment: {
        ALERTS_TABLE_NAME: this.waterAlertsTable.tableName,
        EVENTS_TABLE_NAME: this.waterAlertEventsTable.tableName,
        TELEGRAM_TOKEN_PARAM: this.telegramBotTokenParameterName,
        IMGW_BASE_URL: 'https://danepubliczne.imgw.pl/api/data/hydro/id/',
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      bundling: {
        nodeModules: ['@aws-sdk/client-dynamodb', '@aws-sdk/client-ssm', '@aws-sdk/lib-dynamodb'],
        externalModules: [],
      },
      // Only use depsLockFilePath if it exists (optional)
      ...(fs.existsSync(rootPackageLock) ? { depsLockFilePath: rootPackageLock } : {}),
      projectRoot: projectRoot, // Tell NodejsFunction where the project root is
    });

    // CloudWatch Log Group with 30-day retention
    new logs.LogGroup(this, 'WorkerFunctionLogGroup', {
      logGroupName: `/aws/lambda/${this.workerFunction.functionName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // IAM permissions for Lambda (least privilege)
    // DynamoDB: Only Query on WaterAlerts
    this.workerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Query'],
        resources: [this.waterAlertsTable.tableArn],
      })
    );

    // DynamoDB: Only PutItem on WaterAlertEvents
    this.workerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem'],
        resources: [this.waterAlertEventsTable.tableArn],
      })
    );

    // SSM: GetParameter with decryption for Telegram token
    this.workerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${this.telegramBotTokenParameterName}`,
        ],
      })
    );

    // Output Lambda function name and ARN
    new cdk.CfnOutput(this, 'WorkerFunctionName', {
      value: this.workerFunction.functionName,
      description: 'Name of the Lambda worker function',
      exportName: `${this.stackName}-WorkerFunctionName`,
    });

    new cdk.CfnOutput(this, 'WorkerFunctionArn', {
      value: this.workerFunction.functionArn,
      description: 'ARN of the Lambda worker function',
      exportName: `${this.stackName}-WorkerFunctionArn`,
    });

    // EventBridge Scheduler: Daily execution trigger
    // Schedule: Daily at configured time (default 19:00), timezone Europe/Warsaw
    // For dev/testing: can be overridden via context to run every 5 minutes
    // Example for testing: --context schedule="rate(5 minutes)" (every 5 minutes)
    const scheduleExpression = this.node.tryGetContext('schedule');

    // Create schedule target for Lambda with retry policy
    const scheduleTarget = new targets.LambdaInvoke(this.workerFunction, {
      retryAttempts: 2, // Retry up to 2 times on failure
    });

    // Parse schedule expression
    let schedule: scheduler.ScheduleExpression;
    if (scheduleExpression) {
      // If context override is provided, use it (for testing - e.g., "rate(5 minutes)")
      if (scheduleExpression.startsWith('rate(')) {
        // Parse rate expression like "rate(5 minutes)"
        const match = scheduleExpression.match(/rate\((\d+)\s+(\w+)\)/);
        if (match) {
          const value = parseInt(match[1], 10);
          const unit = match[2].toLowerCase();
          // Map unit to Duration method
          let duration: cdk.Duration;
          if (unit === 'minutes' || unit === 'minute') {
            duration = cdk.Duration.minutes(value);
          } else if (unit === 'hours' || unit === 'hour') {
            duration = cdk.Duration.hours(value);
          } else if (unit === 'days' || unit === 'day') {
            duration = cdk.Duration.days(value);
          } else {
            // Default to minutes
            duration = cdk.Duration.minutes(value);
          }
          schedule = scheduler.ScheduleExpression.rate(duration);
        } else {
          schedule = scheduler.ScheduleExpression.expression(scheduleExpression);
        }
      } else {
        schedule = scheduler.ScheduleExpression.expression(scheduleExpression);
      }
    } else {
      // Default: Daily at 19:00 Europe/Warsaw timezone
      schedule = scheduler.ScheduleExpression.cron({
        minute: '0',
        hour: '19',
        day: '*',
        month: '*',
        year: '*',
        timeZone: cdk.TimeZone.EUROPE_WARSAW,
      });
    }

    this.scheduler = new scheduler.Schedule(this, 'WorkerSchedule', {
      schedule: schedule,
      description: 'Daily trigger for IMGW water level alerts worker (default: 19:00 Europe/Warsaw)',
      enabled: true,
      target: scheduleTarget,
    });

    // Output scheduler name
    new cdk.CfnOutput(this, 'SchedulerName', {
      value: this.scheduler.scheduleName,
      description: 'Name of the EventBridge Scheduler',
      exportName: `${this.stackName}-SchedulerName`,
    });

    // CloudWatch Alarm: Lambda errors
    // Alarms when Lambda function has errors > 0 over 1 day
    const errorAlarm = new cloudwatch.Alarm(this, 'WorkerFunctionErrorAlarm', {
      alarmName: 'imgw-alerts-worker-errors',
      metric: this.workerFunction.metricErrors({
        period: cdk.Duration.days(1),
        statistic: 'Sum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Alerts when Lambda function has errors',
    });

    // Optional: SNS topic for alarm notifications (if email provided via context)
    const alarmEmail = this.node.tryGetContext('alarmEmail');
    if (alarmEmail) {
      const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
        displayName: 'IMGW Alerts Alarm Notifications',
        topicName: 'imgw-alerts-alarms',
      });

      alarmTopic.addSubscription(
        new subscriptions.EmailSubscription(alarmEmail)
      );

      errorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));

      new cdk.CfnOutput(this, 'AlarmTopicArn', {
        value: alarmTopic.topicArn,
        description: 'SNS topic ARN for alarm notifications',
        exportName: `${this.stackName}-AlarmTopicArn`,
      });
    }

    new cdk.CfnOutput(this, 'ErrorAlarmName', {
      value: errorAlarm.alarmName,
      description: 'CloudWatch alarm name for Lambda errors',
      exportName: `${this.stackName}-ErrorAlarmName`,
    });
  }
}
