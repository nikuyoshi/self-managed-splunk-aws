import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import { Construct } from 'constructs';

export interface IndexerInstanceResolverProps {
  autoScalingGroup: autoscaling.AutoScalingGroup;
}

export class IndexerInstanceResolver extends Construct {
  public readonly sessionManagerCommands: string;

  constructor(scope: Construct, id: string, props: IndexerInstanceResolverProps) {
    super(scope, id);

    const { autoScalingGroup } = props;

    // Create Lambda function to get instance IDs
    const getInstancesFunction = new lambda.Function(this, 'GetInstancesFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      code: lambda.Code.fromInline(`
import json
import boto3

def handler(event, context):
    print(f"Event: {json.dumps(event)}")
    
    # Get request type
    request_type = event['RequestType']
    
    # For Delete requests, just return success
    if request_type == 'Delete':
        return {
            'PhysicalResourceId': event.get('PhysicalResourceId', 'indexer-instances'),
            'Data': {
                'Commands': ''
            }
        }
    
    try:
        # Get ASG name from properties
        asg_name = event['ResourceProperties']['AutoScalingGroupName']
        region = event['ResourceProperties']['Region']
        
        # Create boto3 clients
        asg_client = boto3.client('autoscaling', region_name=region)
        ec2_client = boto3.client('ec2', region_name=region)
        
        # Get instances in the ASG
        response = asg_client.describe_auto_scaling_groups(
            AutoScalingGroupNames=[asg_name]
        )
        
        if not response['AutoScalingGroups']:
            raise Exception(f"Auto Scaling Group {asg_name} not found")
        
        asg = response['AutoScalingGroups'][0]
        instance_ids = [i['InstanceId'] for i in asg['Instances'] if i['LifecycleState'] == 'InService']
        
        # Get instance details
        if instance_ids:
            instances_response = ec2_client.describe_instances(InstanceIds=instance_ids)
            
            commands = []
            commands.append("To access indexer instances via Session Manager:")
            commands.append("")
            
            indexer_num = 1
            for reservation in instances_response['Reservations']:
                for instance in reservation['Instances']:
                    instance_id = instance['InstanceId']
                    private_ip = instance['PrivateIpAddress']
                    az = instance['Placement']['AvailabilityZone']
                    
                    commands.append(f"# Indexer {indexer_num} (AZ: {az}, IP: {private_ip})")
                    commands.append(f"aws ssm start-session --target {instance_id}")
                    commands.append("")
                    indexer_num += 1
            
            # Add list command for reference
            commands.append("# To list all indexer instances:")
            commands.append(f"aws ec2 describe-instances --filters \\"Name=tag:aws:autoscaling:groupName,Values={asg_name}\\" \\"Name=instance-state-name,Values=running\\" --query \\"Reservations[*].Instances[*].{{InstanceId:InstanceId,PrivateIp:PrivateIpAddress,AZ:Placement.AvailabilityZone}}\\" --output table")
            
            commands_text = '\\n'.join(commands)
        else:
            # Check if instances are launching
            all_instances = asg['Instances']
            if all_instances:
                launching_count = len([i for i in all_instances if i['LifecycleState'] in ['Pending', 'Pending:Wait', 'Pending:Proceed']])
                commands_text = f"Indexer instances are launching ({launching_count} instances in progress). Please wait a few minutes and check the CloudFormation outputs again."
            else:
                commands_text = "No indexer instances found. The Auto Scaling Group may still be initializing."
        
        return {
            'PhysicalResourceId': f'indexer-instances-{asg_name}',
            'Data': {
                'Commands': commands_text
            }
        }
        
    except Exception as e:
        print(f"Error: {str(e)}")
        raise
`),
      environment: {
        PYTHONUNBUFFERED: '1',
      },
    });

    // Grant permissions to describe ASGs and EC2 instances
    getInstancesFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'autoscaling:DescribeAutoScalingGroups',
        'ec2:DescribeInstances',
      ],
      resources: ['*'],
    }));

    // Create custom resource provider
    const provider = new cr.Provider(this, 'Provider', {
      onEventHandler: getInstancesFunction,
    });

    // Create custom resource
    const customResource = new cdk.CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        AutoScalingGroupName: autoScalingGroup.autoScalingGroupName,
        Region: cdk.Stack.of(this).region,
      },
    });

    // Export the commands
    this.sessionManagerCommands = customResource.getAttString('Commands');
  }
}