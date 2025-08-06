import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';
import { SplunkConfig, defaultTags } from '../config/splunk-config';
import { SplunkDownloadHelper } from './utils/splunk-download-helper';
import { LicenseHelper } from './utils/license-helper';
import { IndexerInstanceResolver } from './constructs/indexer-instance-resolver';

export interface SplunkClusterStackProps extends cdk.StackProps {
  config: SplunkConfig;
  vpc: ec2.Vpc;
  securityGroup: ec2.SecurityGroup;
}

export class SplunkClusterStack extends cdk.Stack {
  public readonly clusterManager: ec2.Instance;
  public readonly indexerAsg: autoscaling.AutoScalingGroup;
  public readonly splunkAdminSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: SplunkClusterStackProps) {
    super(scope, id, props);

    const { config, vpc, securityGroup } = props;

    // Create Splunk admin password secret with key-value format
    this.splunkAdminSecret = new secretsmanager.Secret(this, 'SplunkAdminPassword', {
      description: 'Splunk admin password',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'admin' }),
        generateStringKey: 'password',
        passwordLength: 16,
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\^=',
      },
    });

    // Create IAM role for Splunk instances
    const splunkRole = new iam.Role(this, 'SplunkInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    // Grant read access to the secret
    this.splunkAdminSecret.grantRead(splunkRole);

    // Check for license file and create S3 asset if enabled
    let licenseAsset: s3_assets.Asset | undefined;
    let licenseS3Path: string = '';
    
    if (LicenseHelper.isLicenseInstallEnabled(config)) {
      const licenseInfo = LicenseHelper.getLocalLicenseInfo(config);
      if (licenseInfo) {
        // Create S3 asset from local license file
        licenseAsset = new s3_assets.Asset(this, 'LicenseAsset', {
          path: licenseInfo.path,
        });
        licenseS3Path = licenseAsset.s3ObjectUrl;
        
        // Grant read access to the license file
        licenseAsset.grantRead(splunkRole);
      } else {
        // Display instructions if license is enabled but file not found
        LicenseHelper.displayLicenseInstructions(config);
      }
    }

    // Get latest Amazon Linux 2023 AMI
    const ami = ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.X86_64,
    });

    // Create Cluster Manager instance
    this.clusterManager = new ec2.Instance(this, 'ClusterManager', {
      vpc,
      instanceType: new ec2.InstanceType(config.clusterManagerInstanceType),
      machineImage: ami,
      securityGroup,
      role: splunkRole,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(100, {
          volumeType: ec2.EbsDeviceVolumeType.GP3,
          encrypted: config.enableEncryption,
        }),
      }],
    });

    // Validate Splunk configuration
    SplunkDownloadHelper.validateConfig(config);

    // Basic UserData for Cluster Manager
    this.clusterManager.userData.addCommands(
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
      `ADMIN_PASSWORD=$(aws secretsmanager get-secret-value --secret-id ${this.splunkAdminSecret.secretArn} --query 'SecretString' --output text --region ${this.region} | jq -r '.password')`,
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
      'PASSWORD = $ADMIN_PASSWORD',
      'EOF"',
      '',
      '# Start Splunk and accept license as splunk user',
      'sudo -u splunk /opt/splunk/bin/splunk start --accept-license --answer-yes --no-prompt',
      '',
      '# Stop Splunk before enabling boot-start (required)',
      'sudo -u splunk /opt/splunk/bin/splunk stop',
      '',
      '# Enable boot start with splunk user (run as root to configure systemd)',
      '/opt/splunk/bin/splunk enable boot-start -systemd-managed 1 -user splunk -group splunk',
      '',
      '# Restart Splunk after enabling boot-start',
      'sudo -u splunk /opt/splunk/bin/splunk start',
      '',
      '# Wait for Splunk to fully start and initialize',
      'echo "Waiting for Splunk to initialize..."',
      'for i in {1..12}; do',
      '  if /opt/splunk/bin/splunk list user -auth admin:$ADMIN_PASSWORD >/dev/null 2>&1; then',
      '    echo "Admin user verified successfully"',
      '    break',
      '  fi',
      '  echo "Waiting for admin user to be ready... ($i/12)"',
      '  sleep 5',
      'done',
      '',
      '# Remove user-seed.conf after successful initialization',
      'rm -f /opt/splunk/etc/system/local/user-seed.conf',
      '',
      '# Configure as Cluster Manager (as splunk user)',
      'echo "=== Configuring as Cluster Manager ==="',
      'sudo -u splunk /opt/splunk/bin/splunk edit cluster-config -mode manager -replication_factor 3 -search_factor 2 -secret clustersecret -auth admin:$ADMIN_PASSWORD',
      'if [ $? -eq 0 ]; then',
      '  echo "✅ Successfully configured as Cluster Manager"',
      'else',
      '  echo "❌ ERROR: Failed to configure as Cluster Manager"',
      '  echo "Attempting to continue with deployment..."',
      'fi',
      '',
      '# Restart Splunk to apply cluster configuration',
      'echo "Restarting Splunk to apply cluster configuration..."',
      'sudo -u splunk /opt/splunk/bin/splunk restart',
      '',
      '# Verify cluster manager is running',
      'sleep 10',
      'if sudo -u splunk /opt/splunk/bin/splunk show cluster-config -auth admin:$ADMIN_PASSWORD | grep -q "mode:manager"; then',
      '  echo "✅ Cluster Manager is configured and running"',
      'else',
      '  echo "⚠️  Warning: Cluster Manager may not be properly configured"',
      'fi'
    );

    // Add license installation commands if enabled
    if (licenseAsset && licenseS3Path) {
      this.clusterManager.userData.addCommands(
        '',
        '# Download and install license file',
        'echo "Downloading license file from S3..."',
        `aws s3 cp ${licenseS3Path} /tmp/splunk.license`,
        '',
        ...LicenseHelper.generateInstallScript('/tmp/splunk.license'),
        ...LicenseHelper.generateLicenseMasterScript(),
        '',
        '# Final restart after license installation',
        'sudo -u splunk /opt/splunk/bin/splunk restart'
      );
    }

    // Create Launch Template for Indexers with EBS volumes
    const indexerLaunchTemplate = new ec2.LaunchTemplate(this, 'IndexerLaunchTemplate', {
      machineImage: ami,
      instanceType: new ec2.InstanceType(config.indexerInstanceType),
      securityGroup,
      role: splunkRole,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(100, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: config.enableEncryption,
          }),
        },
        {
          deviceName: '/dev/xvdb',
          volume: ec2.BlockDeviceVolume.ebs(config.indexerHotVolumeSize, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: config.enableEncryption,
          }),
        },
        {
          deviceName: '/dev/xvdc',
          volume: ec2.BlockDeviceVolume.ebs(config.indexerColdVolumeSize, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: config.enableEncryption,
          }),
        },
      ],
    });

    // Create Auto Scaling Group for Indexers
    this.indexerAsg = new autoscaling.AutoScalingGroup(this, 'IndexerASG', {
      vpc,
      launchTemplate: indexerLaunchTemplate,
      minCapacity: config.indexerCount,
      maxCapacity: config.indexerCount,
      desiredCapacity: config.indexerCount,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      healthCheck: autoscaling.HealthCheck.ec2({
        grace: cdk.Duration.minutes(15),
      }),
    });

    // Add block devices for indexers (hot and cold volumes)
    this.indexerAsg.addUserData(
      '#!/bin/bash',
      'set -e',
      'yum update -y',
      '# Fix curl package conflict in AL2023',
      'dnf swap -y curl-minimal curl || true',
      'yum install -y wget jq',
      '',
      '# Format and mount volumes BEFORE installing Splunk',
      '# Format hot volume',
      'mkfs -t xfs /dev/xvdb || true',
      '# Format cold volume',
      'mkfs -t xfs /dev/xvdc || true',
      '',
      '# Create mount points',
      'mkdir -p /opt/splunk/var/lib/splunk',
      'mkdir -p /opt/splunk/cold',
      '',
      '# Mount volumes',
      'mount /dev/xvdb /opt/splunk/var/lib/splunk',
      'mount /dev/xvdc /opt/splunk/cold',
      '',
      '# Add to fstab for persistence',
      'echo "/dev/xvdb /opt/splunk/var/lib/splunk xfs defaults,nofail 0 2" >> /etc/fstab',
      'echo "/dev/xvdc /opt/splunk/cold xfs defaults,nofail 0 2" >> /etc/fstab',
      '',
      ...SplunkDownloadHelper.generateDownloadScript(config),
      '',
      '# Get admin password from Secrets Manager',
      `ADMIN_PASSWORD=$(aws secretsmanager get-secret-value --secret-id ${this.splunkAdminSecret.secretArn} --query 'SecretString' --output text --region ${this.region} | jq -r '.password')`,
      '',
      '# Get Cluster Manager IP',
      `CLUSTER_MANAGER_IP=${this.clusterManager.instancePrivateIp}`,
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
      'PASSWORD = $ADMIN_PASSWORD',
      'EOF"',
      '',
      '# Start Splunk and accept license as splunk user',
      'sudo -u splunk /opt/splunk/bin/splunk start --accept-license --answer-yes --no-prompt',
      '',
      '# Stop Splunk before enabling boot-start (required)',
      'sudo -u splunk /opt/splunk/bin/splunk stop',
      '',
      '# Enable boot start with splunk user (run as root to configure systemd)',
      '/opt/splunk/bin/splunk enable boot-start -systemd-managed 1 -user splunk -group splunk',
      '',
      '# Restart Splunk after enabling boot-start',
      'sudo -u splunk /opt/splunk/bin/splunk start',
      '',
      '# Wait for Splunk to fully start and initialize',
      'echo "Waiting for Splunk to initialize..."',
      'for i in {1..12}; do',
      '  if /opt/splunk/bin/splunk list user -auth admin:$ADMIN_PASSWORD >/dev/null 2>&1; then',
      '    echo "Admin user verified successfully"',
      '    break',
      '  fi',
      '  echo "Waiting for admin user to be ready... ($i/12)"',
      '  sleep 5',
      'done',
      '',
      '# Remove user-seed.conf after successful initialization',
      'rm -f /opt/splunk/etc/system/local/user-seed.conf',
      '',
      '# Wait for Cluster Manager to be ready',
      'echo "=== Waiting for Cluster Manager to be ready ==="',
      'MAX_ATTEMPTS=30',
      'ATTEMPT=1',
      'while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do',
      '  if curl -k -s https://$CLUSTER_MANAGER_IP:8089/services/server/info >/dev/null 2>&1; then',
      '    echo "✅ Cluster Manager is ready at https://$CLUSTER_MANAGER_IP:8089"',
      '    break',
      '  fi',
      '  echo "⏳ Waiting for Cluster Manager... (attempt $ATTEMPT/$MAX_ATTEMPTS)"',
      '  sleep 10',
      '  ATTEMPT=$((ATTEMPT + 1))',
      'done',
      '',
      'if [ $ATTEMPT -gt $MAX_ATTEMPTS ]; then',
      '  echo "❌ ERROR: Cluster Manager not ready after 5 minutes. Check the Cluster Manager instance."',
      '  echo "❌ You can manually join the cluster later using:"',
      '  echo "   /opt/splunk/bin/splunk edit cluster-config -mode peer -manager_uri https://$CLUSTER_MANAGER_IP:8089 -replication_port 9100 -secret clustersecret -auth admin:<password>"',
      'fi',
      '',
      '# Join cluster with proper error handling and restart',
      'echo "=== Joining Splunk cluster ==="',
      'RETRY=1',
      'MAX_RETRY=3',
      'CLUSTER_JOINED=false',
      'while [ $RETRY -le $MAX_RETRY ]; do',
      '  echo "🔄 Attempting to join cluster (attempt $RETRY/$MAX_RETRY)..."',
      '  # Temporarily disable exit on error for this command',
      '  set +e',
      '  OUTPUT=$(sudo -u splunk /opt/splunk/bin/splunk edit cluster-config -mode peer -manager_uri https://$CLUSTER_MANAGER_IP:8089 -replication_port 9100 -secret clustersecret -auth admin:$ADMIN_PASSWORD 2>&1)',
      '  EXITCODE=$?',
      '  set -e',
      '  echo "$OUTPUT"',
      '  ',
      '  # Check for success - the command returns 0 even on some failures, so check output',
      '  if echo "$OUTPUT" | grep -q "The cluster-config property has been edited"; then',
      '    echo "✅ Successfully configured cluster settings"',
      '    CLUSTER_JOINED=true',
      '    # Restart immediately after successful configuration',
      '    echo "=== Restarting Splunk to apply cluster configuration ==="',
      '    sudo -u splunk /opt/splunk/bin/splunk restart',
      '    echo "=== Waiting for Splunk to restart (60 seconds) ==="',
      '    sleep 60',
      '    break',
      '  elif [ $EXITCODE -eq 0 ] && echo "$OUTPUT" | grep -q "mode:peer"; then',
      '    echo "✅ Cluster configuration already set, applying restart"',
      '    CLUSTER_JOINED=true',
      '    sudo -u splunk /opt/splunk/bin/splunk restart',
      '    echo "=== Waiting for Splunk to restart (60 seconds) ==="',
      '    sleep 60',
      '    break',
      '  elif echo "$OUTPUT" | grep -q "Could not contact manager"; then',
      '    echo "⚠️  Failed to contact Cluster Manager on attempt $RETRY"',
      '    if [ $RETRY -lt $MAX_RETRY ]; then',
      '      echo "Will retry in 30 seconds..."',
      '      sleep 30',
      '    fi',
      '  else',
      '    echo "⚠️  Unexpected output on attempt $RETRY, exit code: $EXITCODE"',
      '    if [ $RETRY -lt $MAX_RETRY ]; then',
      '      echo "Will retry in 30 seconds..."',
      '      sleep 30',
      '    fi',
      '  fi',
      '  RETRY=$((RETRY + 1))',
      'done',
      '',
      'if [ "$CLUSTER_JOINED" = "false" ]; then',
      '  echo "❌ ERROR: Failed to join cluster after $MAX_RETRY attempts"',
      '  echo "❌ Manual intervention required"',
      '  # Don\'t exit with error - continue with other configurations',
      '  echo "⚠️  Continuing with remaining configurations..."',
      'fi',
      '',
      '# Configure S2S receiving',
      'echo "=== Configuring S2S receiving ==="',
      '/opt/splunk/bin/splunk enable listen 9997 -auth admin:$ADMIN_PASSWORD || echo "⚠️  Warning: Failed to enable S2S listening"',
      '',
      '# Configure HEC (HTTP Event Collector) with directory creation',
      'echo "=== Configuring HEC ==="',
      '# Ensure app directory exists',
      'mkdir -p /opt/splunk/etc/apps/splunk_httpinput/local',
      '# Create HEC configuration',
      'cat > /opt/splunk/etc/apps/splunk_httpinput/local/inputs.conf << EOF',
      '[http]',
      'disabled = 0',
      'port = 8088',
      '',
      '[http://splunk-aws-hec]',
      'disabled = 0',
      '# Default token for validation environment',
      'token = aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      'indexes = main',
      'EOF',
      '# Fix ownership (user already created during boot-start)',
      'chown -R splunk:splunk /opt/splunk/etc/apps/splunk_httpinput',
      'chown -R splunk:splunk /opt/splunk/var/lib/splunk',
      'chown -R splunk:splunk /opt/splunk/cold',
      '# Also enable HEC via CLI',
      '/opt/splunk/bin/splunk http-event-collector enable -uri https://localhost:8089 -auth admin:$ADMIN_PASSWORD || echo "⚠️  Warning: Failed to enable HEC via CLI"',
      '/opt/splunk/bin/splunk http-event-collector create default-token -uri https://localhost:8089 -description "Default HEC token" -indexes main -auth admin:$ADMIN_PASSWORD || echo "⚠️  Warning: Failed to create HEC token"',
      'echo "✅ HEC configuration created"',
      '',
      '# Configure cold path',
      'echo "=== Configuring cold path ==="',
      '/opt/splunk/bin/splunk set datastore-dir coldPath /opt/splunk/cold -auth admin:$ADMIN_PASSWORD || echo "⚠️  Warning: Failed to set cold path"',
      '',
      '# Configure license peer if license is enabled',
      ...LicenseHelper.isLicenseInstallEnabled(config) ? 
        LicenseHelper.generateLicensePeerScript(this.clusterManager.instancePrivateIp) : 
        [],
      '',
      '# Final restart to apply all configurations',
      'echo "=== Final Splunk restart ==="',
      '/opt/splunk/bin/splunk restart',
      'echo "=== Waiting for Splunk to fully start (30 seconds) ==="',
      'sleep 30',
      '',
      '# Verify cluster membership',
      'echo "=== Verifying cluster membership ==="',
      'MEMBER_INFO=$(/opt/splunk/bin/splunk list cluster-config -auth admin:$ADMIN_PASSWORD 2>&1)',
      'if echo "$MEMBER_INFO" | grep -q "mode:slave"; then',
      '  echo "✅ Cluster membership verified successfully"',
      '  echo "$MEMBER_INFO" | grep -E "manager_uri|mode|site"',
      'else',
      '  echo "❌ ERROR: Failed to verify cluster membership"',
      '  echo "$MEMBER_INFO"',
      'fi',
      '',
      'echo "=== Indexer initialization complete ==="'
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
    new cdk.CfnOutput(this, 'ClusterManagerPrivateIp', {
      value: this.clusterManager.instancePrivateIp,
      exportName: `${this.stackName}-ClusterManagerIP`,
    });

    new cdk.CfnOutput(this, 'SplunkAdminSecretArn', {
      value: this.splunkAdminSecret.secretArn,
      exportName: `${this.stackName}-AdminSecretArn`,
    });

    new cdk.CfnOutput(this, 'SplunkAdminSecretConsoleUrl', {
      value: `https://console.aws.amazon.com/secretsmanager/secret?name=${this.splunkAdminSecret.secretName}&region=${this.region}`,
      description: 'Direct link to the Splunk admin password in AWS Secrets Manager',
    });

    new cdk.CfnOutput(this, 'ClusterManagerWebUrl', {
      value: `http://${this.clusterManager.instancePrivateIp}:8000`,
      description: 'Cluster Manager Web UI URL (accessible from within VPC)',
    });

    new cdk.CfnOutput(this, 'ClusterManagerSessionManagerCommand', {
      value: `aws ssm start-session --target ${this.clusterManager.instanceId}`,
      description: 'Command to connect to Cluster Manager via Session Manager',
    });

    // License installation status output
    new cdk.CfnOutput(this, 'LicenseInstallationStatus', {
      value: config.enableLicenseInstall ? 
        'License installation ENABLED - Cluster Manager will be configured as License Master' : 
        'License installation DISABLED - Using 60-day trial license (500MB/day)',
      description: 'Status of Splunk Enterprise license installation',
    });

    if (config.enableLicenseInstall) {
      new cdk.CfnOutput(this, 'LicenseFilePath', {
        value: config.licensePackageLocalPath || './licenses',
        description: 'Expected location of license file',
      });

      new cdk.CfnOutput(this, 'LicenseFileStatus', {
        value: licenseAsset ? 
          `✅ License file found and will be installed: ${licenseAsset.s3ObjectKey}` : 
          '❌ License file NOT FOUND - Please check the licenses directory',
        description: 'License file detection status',
      });

      new cdk.CfnOutput(this, 'LicenseCheckCommand', {
        value: `sudo -u splunk /opt/splunk/bin/splunk list licenses -auth admin:<password>`,
        description: 'Command to verify installed licenses (run on Cluster Manager)',
      });
    }

    // Create custom resource to get indexer instance IDs
    const indexerResolver = new IndexerInstanceResolver(this, 'IndexerResolver', {
      autoScalingGroup: this.indexerAsg,
    });

    new cdk.CfnOutput(this, 'IndexerAccessCommands', {
      value: indexerResolver.sessionManagerCommands,
      description: 'Commands to access Indexer instances via Session Manager',
    });

    new cdk.CfnOutput(this, 'IndexerListCommand', {
      value: `aws ec2 describe-instances --filters "Name=tag:aws:autoscaling:groupName,Values=${this.indexerAsg.autoScalingGroupName}" "Name=instance-state-name,Values=running" --query "Reservations[*].Instances[*].{InstanceId:InstanceId,PrivateIp:PrivateIpAddress,AZ:Placement.AvailabilityZone}" --output table`,
      description: 'Command to list all Indexer instances',
    });

    new cdk.CfnOutput(this, 'IndexerConfiguration', {
      value: `Count: ${config.indexerCount} | Instance Type: ${config.indexerInstanceType} | Replication Factor: ${config.replicationFactor} | Search Factor: ${config.searchFactor}`,
      description: 'Indexer cluster configuration summary',
    });

    // Troubleshooting guide output
    new cdk.CfnOutput(this, 'IndexerTroubleshootingGuide', {
      value: [
        'If Indexers fail to join cluster:',
        `1. Connect via: aws ssm start-session --target <indexer-instance-id>`,
        '2. Check logs: tail -100 /var/log/cloud-init-output.log | grep -E "(cluster|ERROR)"',
        '3. Check cluster status: /opt/splunk/bin/splunk show cluster-member-info -auth admin:<password>',
        `4. Manual fix: /opt/splunk/bin/splunk edit cluster-config -mode peer -manager_uri https://${this.clusterManager.instancePrivateIp}:8089 -replication_port 9100 -secret clustersecret -auth admin:<password>`,
        '5. Restart Splunk: /opt/splunk/bin/splunk restart',
        '6. Verify: /opt/splunk/bin/splunk list cluster-config -auth admin:<password>'
      ].join(' | '),
      description: 'Quick troubleshooting guide for Indexer cluster join issues',
    });

    new cdk.CfnOutput(this, 'ClusterHealthCheckCommand', {
      value: `/opt/splunk/bin/splunk show cluster-status -auth admin:<password>`,
      description: 'Command to check overall cluster health (run on Cluster Manager)',
    });

    new cdk.CfnOutput(this, 'DataIngestionPorts', {
      value: 'S2S: 9997 | HEC: 8088 | Management: 8089',
      description: 'Splunk data ingestion and management ports',
    });
  }
}