import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
// ALB imports removed - using Elastic IP instead
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { SplunkConfig, defaultTags } from '../config/splunk-config';
import { SplunkDownloadHelper } from './utils/splunk-download-helper';
import { LicenseHelper } from './utils/license-helper';

export interface SplunkSearchStackProps extends cdk.StackProps {
  config: SplunkConfig;
  vpc: ec2.Vpc;
  splunkSecurityGroup: ec2.SecurityGroup;
  clusterManagerIp: string;
  splunkAdminSecret: secretsmanager.Secret;
}

export class SplunkSearchStack extends cdk.Stack {
  public readonly searchHead: ec2.Instance;
  public readonly elasticIp: string;

  constructor(scope: Construct, id: string, props: SplunkSearchStackProps) {
    super(scope, id, props);

    const { 
      config, 
      vpc, 
      splunkSecurityGroup,
      clusterManagerIp,
      splunkAdminSecret 
    } = props;

    // Create IAM role for Search Head
    const searchHeadRole = new iam.Role(this, 'SearchHeadRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    // Grant read access to the secret
    splunkAdminSecret.grantRead(searchHeadRole);

    // Get latest Amazon Linux 2023 AMI
    const ami = ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.X86_64,
    });

    // Create Search Head instance
    this.searchHead = new ec2.Instance(this, 'SearchHead', {
      vpc,
      instanceType: new ec2.InstanceType(config.searchHeadInstanceType),
      machineImage: ami,
      securityGroup: splunkSecurityGroup,
      role: searchHeadRole,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      associatePublicIpAddress: true,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(config.searchHeadVolumeSize, {
          volumeType: ec2.EbsDeviceVolumeType.GP3,
          encrypted: config.enableEncryption,
        }),
      }],
    });

    // Validate Splunk configuration
    SplunkDownloadHelper.validateConfig(config);

    // UserData for Search Head
    this.searchHead.userData.addCommands(
      '#!/bin/bash',
      'set -e',
      'yum update -y',
      '# Fix curl package conflict in AL2023',
      'dnf swap -y curl-minimal curl || true',
      'yum install -y wget jq',
      '',
      ...SplunkDownloadHelper.generateDownloadScript(config),
      '',
      '# Get admin password from Secrets Manager',
      `ADMIN_PASSWORD=$(aws secretsmanager get-secret-value --secret-id ${splunkAdminSecret.secretArn} --query 'SecretString' --output text --region ${this.region} | jq -r '.password')`,
      '',
      '# Create splunk user and group FIRST (before any Splunk operations)',
      'groupadd splunk || true',
      'useradd -g splunk -d /opt/splunk -s /bin/bash splunk || true',
      '',
      '# Set ownership BEFORE any Splunk operations',
      'chown -R splunk:splunk /opt/splunk',
      '',
      '# Ensure clean start - remove existing passwd file if exists',
      'if [ -f /opt/splunk/etc/passwd ]; then',
      '  echo "Removing existing passwd file for clean start"',
      '  sudo -u splunk rm -f /opt/splunk/etc/passwd',
      'fi',
      '',
      '# Create user-seed.conf for initial admin user as splunk user',
      'sudo -u splunk mkdir -p /opt/splunk/etc/system/local',
      'sudo -u splunk bash -c "cat > /opt/splunk/etc/system/local/user-seed.conf << EOF',
      '[user_info]',
      'USERNAME = admin',
      'PASSWORD = \'"$ADMIN_PASSWORD"\'',
      'EOF"',
      '',
      '# Start Splunk and accept license as splunk user',
      'sudo -u splunk /opt/splunk/bin/splunk start --accept-license --answer-yes --no-prompt',
      '',
      '# Wait for Splunk to fully start and initialize',
      'echo "Waiting for Splunk to initialize and create admin user..."',
      'for i in {1..12}; do',
      '  if sudo -u splunk /opt/splunk/bin/splunk list user -auth admin:$ADMIN_PASSWORD >/dev/null 2>&1; then',
      '    echo "✅ Admin user verified successfully"',
      '    break',
      '  fi',
      '  echo "Waiting for admin user to be ready... ($i/12)"',
      '  sleep 5',
      'done',
      '',
      '# Verify admin user was created successfully',
      'if ! sudo -u splunk /opt/splunk/bin/splunk list user -auth admin:$ADMIN_PASSWORD >/dev/null 2>&1; then',
      '  echo "❌ ERROR: Admin user creation failed after multiple attempts"',
      '  echo "❌ ERROR: Cannot proceed without admin user"',
      '  exit 1',
      'fi',
      '',
      '# Remove user-seed.conf after successful verification',
      'sudo -u splunk rm -f /opt/splunk/etc/system/local/user-seed.conf',
      '',
      '# Stop Splunk before enabling boot-start',
      'sudo -u splunk /opt/splunk/bin/splunk stop',
      '',
      '# Enable boot start with splunk user (use init.d for simpler management)',
      '/opt/splunk/bin/splunk enable boot-start -systemd-managed 0 -user splunk -group splunk',
      '',
      '# Start Splunk after enabling boot-start',
      'sudo -u splunk /opt/splunk/bin/splunk start',
      '',
      '# Configure as Search Head (as splunk user)',
      `if ! sudo -u splunk /opt/splunk/bin/splunk edit cluster-config -mode searchhead -manager_uri https://${clusterManagerIp}:8089 -secret clustersecret -auth admin:$ADMIN_PASSWORD; then`,
      '  echo "ERROR: Failed to configure cluster mode"',
      '  echo "ERROR: Search Head will not be able to connect to Indexer cluster"',
      '  # Continue anyway as this can be fixed manually later',
      'fi',
      '',
      '# Web interface is already accessible on port 8000 without SSL',
      '# Skipping web-ssl configuration as the command syntax is incorrect',
      '',
      '# Configure license peer if license is enabled',
      ...config.enableLicenseInstall ? 
        LicenseHelper.generateLicensePeerScript(clusterManagerIp) : 
        [],
      '',
      '# Restart Splunk (as splunk user)',
      'sudo -u splunk /opt/splunk/bin/splunk restart',
      '',
      '# Wait for Splunk to fully restart',
      'echo "Waiting for Splunk to restart..."',
      'sleep 30',
      '',
      '# === Configure Search Head as cluster-aware ===',
      'echo "=== Configuring Search Head as cluster-aware ==="',
      '',
      '# Configure this Search Head to be aware of the indexer cluster',
      'echo "Setting Search Head to cluster-aware mode..."',
      `sudo -u splunk /opt/splunk/bin/splunk edit cluster-config -mode searchhead -manager_uri https://${clusterManagerIp}:8089 -secret clustersecret -auth admin:$ADMIN_PASSWORD`,
      'if [ $? -eq 0 ]; then',
      '  echo "✅ Search Head configured as cluster-aware"',
      'else',
      '  echo "⚠️  Warning: Failed to configure Search Head as cluster-aware"',
      'fi',
      '',
      '# === Configure distributed search for all indexers ===',
      'echo "=== Configuring distributed search for all indexers ==="',
      '',
      '# Wait for expected number of indexers to join the cluster',
      'EXPECTED_INDEXERS=3',
      'MAX_WAIT_TIME=600  # 10 minutes',
      'WAIT_INTERVAL=30   # 30 seconds',
      'ELAPSED=0',
      '',
      'echo "Waiting for $EXPECTED_INDEXERS indexers to join the cluster..."',
      '',
      'while [ $ELAPSED -lt $MAX_WAIT_TIME ]; do',
      '  # Get current peer count from cluster status',
      '  PEER_COUNT=$(sudo -u splunk /opt/splunk/bin/splunk show cluster-status -auth admin:$ADMIN_PASSWORD 2>/dev/null | grep -c "Peer name:" || echo "0")',
      '  PEER_COUNT=$(echo "$PEER_COUNT" | head -1 | tr -d "\\n")',
      '  ',
      '  if [ "$PEER_COUNT" -ge "$EXPECTED_INDEXERS" ]; then',
      '    echo "✅ Found $PEER_COUNT indexers in the cluster"',
      '    break',
      '  fi',
      '  ',
      '  echo "⏳ Currently $PEER_COUNT/$EXPECTED_INDEXERS indexers in cluster. Waiting..."',
      '  sleep $WAIT_INTERVAL',
      '  ELAPSED=$((ELAPSED + WAIT_INTERVAL))',
      'done',
      '',
      'if [ "$PEER_COUNT" -lt "$EXPECTED_INDEXERS" ]; then',
      '  echo "⚠️  Warning: Only found $PEER_COUNT indexers after waiting $ELAPSED seconds"',
      '  echo "⚠️  Proceeding with available indexers..."',
      'fi',
      '',
      '# Configure distributed search for all cluster peers',
      'echo "Adding cluster peers as search servers..."',
      'ADDED_COUNT=0',
      'FAILED_COUNT=0',
      '',
      '# Get list of all peers and their details',
      'sudo -u splunk /opt/splunk/bin/splunk show cluster-status -auth admin:$ADMIN_PASSWORD 2>/dev/null | grep -A2 "Peer name:" | while read -r line; do',
      '  if [[ "$line" =~ "Peer name:" ]]; then',
      '    PEER_NAME=$(echo "$line" | awk -F": " \'{print $2}\')',
      '  elif [[ "$line" =~ "Peer site:" ]]; then',
      '    PEER_SITE=$(echo "$line" | awk -F": " \'{print $2}\')',
      '    # Get the host info which is in format "host:port"',
      '    PEER_HOST_INFO=$(sudo -u splunk /opt/splunk/bin/splunk list cluster-peers -auth admin:$ADMIN_PASSWORD 2>/dev/null | grep -A5 "$PEER_NAME" | grep "Host name:" | awk \'{print $3}\')',
      '    PEER_IP=$(echo "$PEER_HOST_INFO" | cut -d: -f1)',
      '    ',
      '    if [ -z "$PEER_IP" ]; then',
      '      echo "❌ Could not determine IP for peer $PEER_NAME"',
      '      FAILED_COUNT=$((FAILED_COUNT + 1))',
      '      continue',
      '    fi',
      '    ',
      '    echo "Adding search server: $PEER_IP (Name: $PEER_NAME)"',
      '    ',
      '    # Try to add the search server',
      '    if sudo -u splunk /opt/splunk/bin/splunk add search-server https://$PEER_IP:8089 -auth admin:$ADMIN_PASSWORD -remoteUsername admin -remotePassword $ADMIN_PASSWORD 2>&1; then',
      '      echo "✅ Successfully added $PEER_IP as search server"',
      '      ADDED_COUNT=$((ADDED_COUNT + 1))',
      '    else',
      '      # Check if already exists',
      '      if sudo -u splunk /opt/splunk/bin/splunk list search-server -auth admin:$ADMIN_PASSWORD 2>/dev/null | grep -q "$PEER_IP"; then',
      '        echo "ℹ️  Search server $PEER_IP already configured"',
      '        ADDED_COUNT=$((ADDED_COUNT + 1))',
      '      else',
      '        echo "❌ Failed to add $PEER_IP as search server"',
      '        FAILED_COUNT=$((FAILED_COUNT + 1))',
      '      fi',
      '    fi',
      '  fi',
      'done',
      '',
      'echo "=== Distributed search configuration complete ==="',
      'echo "✅ Added/verified $ADDED_COUNT search servers"',
      'if [ $FAILED_COUNT -gt 0 ]; then',
      '  echo "⚠️  Failed to add $FAILED_COUNT search servers"',
      'fi',
      '',
      '# Verify distributed search configuration',
      'echo "=== Verifying distributed search configuration ==="',
      'sudo -u splunk /opt/splunk/bin/splunk list search-server -auth admin:$ADMIN_PASSWORD || echo "⚠️  Could not list search servers"',
      '',
      '# Final restart to ensure all configurations are loaded',
      'echo "=== Final Splunk restart ==="',
      'sudo -u splunk /opt/splunk/bin/splunk restart',
      '',
      'echo "=== Search Head initialization complete ==="'
    );

    // Create Elastic IP
    const eip = new ec2.CfnEIP(this, 'SearchHeadEIP', {
      domain: 'vpc',
      tags: [{
        key: 'Name',
        value: `${this.stackName}-SearchHead-EIP`,
      }],
    });

    // Associate Elastic IP with the instance
    new ec2.CfnEIPAssociation(this, 'SearchHeadEIPAssoc', {
      allocationId: eip.attrAllocationId,
      instanceId: this.searchHead.instanceId,
    });

    // Store Elastic IP
    this.elasticIp = eip.attrPublicIp;

    // Allow inbound traffic on port 8000 from anywhere (restrict in production)
    this.searchHead.connections.allowFromAnyIpv4(
      ec2.Port.tcp(8000),
      'Allow Splunk Web UI access'
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
    new cdk.CfnOutput(this, 'SearchHeadPrivateIp', {
      value: this.searchHead.instancePrivateIp,
      exportName: `${this.stackName}-SearchHeadIP`,
      description: 'Private IP address of the Search Head instance',
    });

    new cdk.CfnOutput(this, 'SplunkWebUrl', {
      value: `http://${this.elasticIp}:8000`,
      description: 'Splunk Web UI URL (username: admin, password: check Secrets Manager)',
    });

    new cdk.CfnOutput(this, 'SearchHeadElasticIP', {
      value: this.elasticIp,
      description: 'Elastic IP address of the Search Head',
    });

    new cdk.CfnOutput(this, 'SearchHeadSessionManagerCommand', {
      value: `aws ssm start-session --target ${this.searchHead.instanceId}`,
      description: 'Command to connect to Search Head via Session Manager',
    });

    new cdk.CfnOutput(this, 'SearchHeadAdminSecretConsoleUrl', {
      value: `https://console.aws.amazon.com/secretsmanager/secret?name=${splunkAdminSecret.secretName}&region=${this.region}`,
      description: 'Direct link to the Splunk admin password in AWS Secrets Manager',
    });

    new cdk.CfnOutput(this, 'SearchHeadConfiguration', {
      value: `Instance Type: ${config.searchHeadInstanceType} | Storage: ${config.searchHeadVolumeSize}GB | Port: 8000`,
      description: 'Search Head configuration summary',
    });

    // License status outputs
    new cdk.CfnOutput(this, 'SearchHeadLicenseStatus', {
      value: config.enableLicenseInstall ? 
        '✅ License enabled - Search Head configured as license peer to Cluster Manager' : 
        '⚠️ Using 60-day trial license (500MB/day)',
      description: 'Splunk Enterprise license status for Search Head',
    });

    new cdk.CfnOutput(this, 'SearchHeadLicenseCheckCommand', {
      value: `sudo -u splunk /opt/splunk/bin/splunk list licenses -auth admin:<password>`,
      description: 'Command to verify license status on Search Head',
    });
  }
}