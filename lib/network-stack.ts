import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { SplunkConfig, defaultTags } from '../config/splunk-config';

export interface NetworkStackProps extends cdk.StackProps {
  config: SplunkConfig;
}

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly splunkClusterSecurityGroup: ec2.SecurityGroup;
  public readonly s2sSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Create VPC with 3 AZs as per SVA requirements
    // Note: Using 1 NAT Gateway to reduce costs while maintaining internet connectivity
    // For production, consider using 3 NAT Gateways (one per AZ) for high availability
    this.vpc = new ec2.Vpc(this, 'SplunkVpc', {
      ipAddresses: ec2.IpAddresses.cidr(config.vpcCidr),
      maxAzs: config.maxAzs,
      natGateways: 1, // Reduced from 3 to save ~$100/month. Use natGateways: config.maxAzs for HA
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Create security group for Splunk cluster internal communication
    this.splunkClusterSecurityGroup = new ec2.SecurityGroup(this, 'SplunkClusterSG', {
      vpc: this.vpc,
      description: 'Security group for Splunk cluster internal communication',
      allowAllOutbound: true,
    });

    // Allow internal communication within the cluster
    this.splunkClusterSecurityGroup.addIngressRule(
      this.splunkClusterSecurityGroup,
      ec2.Port.tcp(8089),
      'Splunk management port'
    );
    
    this.splunkClusterSecurityGroup.addIngressRule(
      this.splunkClusterSecurityGroup,
      ec2.Port.tcp(9997),
      'Splunk S2S port'
    );
    
    // Cluster replication ports (expanded range to include default 9000 and custom ports like 9887)
    this.splunkClusterSecurityGroup.addIngressRule(
      this.splunkClusterSecurityGroup,
      ec2.Port.tcpRange(9000, 9999),
      'Splunk replication ports'
    );

    // Allow direct access to Splunk Web UI from anywhere (restrict in production)
    this.splunkClusterSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8000),
      'Direct Splunk Web UI access'
    );

    // Create security group for S2S data ingestion
    this.s2sSecurityGroup = new ec2.SecurityGroup(this, 'S2sSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Splunk-to-Splunk data ingestion',
      allowAllOutbound: true,
    });

    // For MVP, allow S2S from anywhere (will be restricted later)
    this.s2sSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(9997),
      'S2S data ingestion'
    );

    // Allow S2S traffic to reach indexers
    this.splunkClusterSecurityGroup.addIngressRule(
      this.s2sSecurityGroup,
      ec2.Port.tcp(9997),
      'S2S to Indexers'
    );

    // Allow HEC (HTTP Event Collector) traffic
    this.splunkClusterSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8088),
      'HEC data ingestion'
    );

    // Add S3 Gateway Endpoint (free) to reduce data transfer costs
    // This allows EC2 instances to access S3 without going through the NAT Gateway
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // Apply tags to all resources in this stack
    cdk.Tags.of(this).add('splunkit_environment_type', defaultTags.splunkit_environment_type);
    cdk.Tags.of(this).add('splunkit_data_classification', defaultTags.splunkit_data_classification);
    if (defaultTags.project) {
      cdk.Tags.of(this).add('Project', defaultTags.project);
    }
    if (defaultTags.owner) {
      cdk.Tags.of(this).add('Owner', defaultTags.owner);
    }
    if (defaultTags.costCenter) {
      cdk.Tags.of(this).add('CostCenter', defaultTags.costCenter);
    }

    // Export values for other stacks
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      exportName: `${this.stackName}-VpcId`,
    });

    new cdk.CfnOutput(this, 'SplunkClusterSecurityGroupId', {
      value: this.splunkClusterSecurityGroup.securityGroupId,
      exportName: `${this.stackName}-SplunkClusterSGId`,
    });

    // User-friendly outputs
    new cdk.CfnOutput(this, 'DeploymentRegion', {
      value: this.region,
      description: 'AWS Region where Splunk is deployed',
    });

    new cdk.CfnOutput(this, 'VpcCidr', {
      value: config.vpcCidr,
      description: 'VPC CIDR block for the Splunk deployment',
    });

    new cdk.CfnOutput(this, 'AvailabilityZones', {
      value: this.vpc.availabilityZones.join(', '),
      description: 'Availability Zones used for high availability',
    });

  }
}