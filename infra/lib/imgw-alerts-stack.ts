import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface ImgwAlertsStackProps extends cdk.StackProps {
  // Add custom props here if needed
}

export class ImgwAlertsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: ImgwAlertsStackProps) {
    super(scope, id, props);

    // Apply standard tags to all resources in this stack
    cdk.Tags.of(this).add('Project', 'imgw-alerts');
    cdk.Tags.of(this).add('Environment', this.node.tryGetContext('env') || 'dev');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // TODO: Add resources here
    // - DynamoDB tables (WaterAlerts, WaterAlertEvents)
    // - Lambda function
    // - EventBridge Scheduler
    // - IAM roles and policies
    // - SSM parameter (placeholder)

    // Dummy resource for initial bootstrap test
    // This will be replaced with actual resources in subsequent tasks
    new cdk.CfnOutput(this, 'StackName', {
      value: this.stackName,
      description: 'Name of this CDK stack',
    });
  }
}
