import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { SplunkConfig, defaultTags } from '../config/splunk-config';

export interface SplunkDataIngestionStackProps extends cdk.StackProps {
  config: SplunkConfig;
  vpc: ec2.Vpc;
  indexerAsg: autoscaling.AutoScalingGroup;
  splunkSecurityGroup: ec2.SecurityGroup;
  domainName?: string; // Optional domain name for SSL certificate
  hostedZoneId?: string; // Optional Route53 hosted zone ID for DNS validation
}

export class SplunkDataIngestionStack extends cdk.Stack {
  public readonly nlb: elbv2.NetworkLoadBalancer;
  public readonly s2sTargetGroup: elbv2.NetworkTargetGroup;
  public readonly hecTargetGroup: elbv2.NetworkTargetGroup;
  public readonly hecHttpsTargetGroup: elbv2.NetworkTargetGroup;
  private certificate?: acm.ICertificate;

  constructor(scope: Construct, id: string, props: SplunkDataIngestionStackProps) {
    super(scope, id, props);

    const { vpc, indexerAsg, splunkSecurityGroup } = props;

    // Create Network Load Balancer for data ingestion
    this.nlb = new elbv2.NetworkLoadBalancer(this, 'DataIngestionNLB', {
      vpc,
      internetFacing: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      crossZoneEnabled: true, // Enable cross-zone load balancing for better distribution
    });

    // Create Target Group for S2S (Splunk-to-Splunk) traffic
    this.s2sTargetGroup = new elbv2.NetworkTargetGroup(this, 'S2STargetGroup', {
      port: 9997,
      protocol: elbv2.Protocol.TCP,
      vpc,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        enabled: true,
        port: '8089', // Use management port for health check
        protocol: elbv2.Protocol.TCP,
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Create Target Group for HEC (HTTP Event Collector) traffic
    this.hecTargetGroup = new elbv2.NetworkTargetGroup(this, 'HECTargetGroup', {
      port: 8088,
      protocol: elbv2.Protocol.TCP,
      vpc,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        enabled: true,
        port: '8089', // Use management port for health check
        protocol: elbv2.Protocol.TCP,
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Add listener for S2S traffic
    this.nlb.addListener('S2SListener', {
      port: 9997,
      protocol: elbv2.Protocol.TCP,
      defaultTargetGroups: [this.s2sTargetGroup],
    });

    // Add listener for HEC traffic (HTTP)
    this.nlb.addListener('HECListener', {
      port: 8088,
      protocol: elbv2.Protocol.TCP,
      defaultTargetGroups: [this.hecTargetGroup],
    });

    // Create HTTPS target group for HEC (same backend port 8088)
    this.hecHttpsTargetGroup = new elbv2.NetworkTargetGroup(this, 'HECHttpsTargetGroup', {
      port: 8088,
      protocol: elbv2.Protocol.TCP,
      vpc,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        enabled: true,
        port: '8089',
        protocol: elbv2.Protocol.TCP,
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Add HTTPS listener for HEC traffic (port 443)
    // Check if ACM certificate is provided or should be created
    if (props.domainName) {
      // Create or import ACM certificate
      if (props.hostedZoneId) {
        // Create new certificate with DNS validation
        this.certificate = new acm.Certificate(this, 'HECCertificate', {
          domainName: props.domainName,
          validation: acm.CertificateValidation.fromDns(),
        });
      } else {
        // Import existing certificate by ARN (passed as domainName)
        if (props.domainName.startsWith('arn:')) {
          this.certificate = acm.Certificate.fromCertificateArn(this, 'HECCertificate', props.domainName);
        }
      }

      if (this.certificate) {
        // Add TLS listener for HTTPS HEC traffic
        this.nlb.addListener('HECHttpsListener', {
          port: 443,
          protocol: elbv2.Protocol.TLS,
          certificates: [this.certificate],
          defaultTargetGroups: [this.hecHttpsTargetGroup],
        });
      }
    } else {
      // Add TCP listener on port 443 (without TLS termination)
      this.nlb.addListener('HECHttpsListener', {
        port: 443,
        protocol: elbv2.Protocol.TCP,
        defaultTargetGroups: [this.hecHttpsTargetGroup],
      });
    }

    // Register the Auto Scaling Group with all target groups
    this.s2sTargetGroup.addTarget(indexerAsg);
    this.hecTargetGroup.addTarget(indexerAsg);
    this.hecHttpsTargetGroup.addTarget(indexerAsg);

    // Allow NLB to reach Indexers on S2S port
    splunkSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(9997),
      'Allow S2S from NLB'
    );

    // Allow NLB to reach Indexers on HEC port
    splunkSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8088),
      'Allow HEC from NLB'
    );

    // Allow health checks from NLB
    splunkSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8089),
      'Allow health checks from NLB'
    );

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

    // Outputs
    new cdk.CfnOutput(this, 'NLBDnsName', {
      value: this.nlb.loadBalancerDnsName,
      description: 'DNS name of the Network Load Balancer for data ingestion',
      exportName: `${this.stackName}-NLBDnsName`,
    });

    new cdk.CfnOutput(this, 'S2SEndpoint', {
      value: `${this.nlb.loadBalancerDnsName}:9997`,
      description: 'Splunk-to-Splunk (S2S) data forwarding endpoint',
    });

    new cdk.CfnOutput(this, 'HECEndpoint', {
      value: `http://${this.nlb.loadBalancerDnsName}:8088`,
      description: 'HTTP Event Collector (HEC) endpoint',
    });

    new cdk.CfnOutput(this, 'HECHttpsEndpoint', {
      value: this.certificate ? `https://${props.domainName || this.nlb.loadBalancerDnsName}:443` : `https://${this.nlb.loadBalancerDnsName}:443`,
      description: 'HTTPS Event Collector (HEC) endpoint - SSL/TLS enabled',
    });

    new cdk.CfnOutput(this, 'HECTokenCommand', {
      value: 'Get HEC token: /opt/splunk/bin/splunk http-event-collector list -auth admin:<password>',
      description: 'Command to retrieve HEC tokens from any indexer',
    });

    new cdk.CfnOutput(this, 'ForwarderConfiguration', {
      value: [
        'Configure your forwarders with:',
        `[tcpout:splunk-aws]`,
        `server = ${this.nlb.loadBalancerDnsName}:9997`,
      ].join(' '),
      description: 'Example forwarder configuration',
    });

    new cdk.CfnOutput(this, 'SecurityNote', {
      value: this.certificate 
        ? 'HTTPS/TLS is configured for HEC on port 443. S2S on port 9997 still requires manual TLS configuration.'
        : 'For production use: 1) Provide domainName parameter for ACM certificate, or 2) Configure TLS certificates manually on Splunk instances.',
      description: 'Security configuration status',
    });

    if (!this.certificate) {
      new cdk.CfnOutput(this, 'EnableHTTPS', {
        value: 'To enable HTTPS: Deploy with --context domainName=your-domain.com or domainName=arn:aws:acm:region:account:certificate/id',
        description: 'How to enable HTTPS for HEC',
      });
    }
  }
}