import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface ImgwAlertsStackProps extends cdk.StackProps {
  // Add custom props here if needed
}

export class ImgwAlertsStack extends cdk.Stack {
  public readonly waterAlertsTable: dynamodb.Table;
  public readonly waterAlertEventsTable: dynamodb.Table;
  public readonly telegramBotTokenParameterName: string;

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

    // TODO: Add remaining resources
    // - Lambda function
    // - EventBridge Scheduler
    // - IAM roles and policies
  }
}
