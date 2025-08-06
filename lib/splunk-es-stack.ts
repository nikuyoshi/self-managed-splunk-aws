import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
// ALB imports removed - using Elastic IP instead
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';
import { SplunkConfig, defaultTags } from '../config/splunk-config';
import { SplunkDownloadHelper } from './utils/splunk-download-helper';
import { LicenseHelper } from './utils/license-helper';
import { ESDownloadHelper } from './utils/es-download-helper';

export interface SplunkEsStackProps extends cdk.StackProps {
  config: SplunkConfig;
  vpc: ec2.Vpc;
  splunkSecurityGroup: ec2.SecurityGroup;
  clusterManagerIp: string;
  splunkAdminSecret: secretsmanager.Secret;
}

export class SplunkEsStack extends cdk.Stack {
  public readonly esSearchHead: ec2.Instance;
  public readonly elasticIp: string;

  constructor(scope: Construct, id: string, props: SplunkEsStackProps) {
    super(scope, id, props);

    const { 
      config, 
      vpc, 
      splunkSecurityGroup,
      clusterManagerIp,
      splunkAdminSecret
    } = props;

    // Get ES package info
    const esPackageInfo = ESDownloadHelper.getLocalPackageInfo(config);
    let esAsset: s3_assets.Asset | undefined;
    let esPackageS3Path: string = '';

    if (esPackageInfo) {
      // Create S3 asset from local ES package
      esAsset = new s3_assets.Asset(this, 'ESPackageAsset', {
        path: esPackageInfo.path,
      });
      esPackageS3Path = esAsset.s3ObjectUrl;
    }

    // Create IAM role for ES Search Head
    const esSearchHeadRole = new iam.Role(this, 'EsSearchHeadRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    // Grant read access to the secret
    splunkAdminSecret.grantRead(esSearchHeadRole);

    // Grant read access to ES package in S3 if it exists
    if (esAsset) {
      esAsset.grantRead(esSearchHeadRole);
    }

    // Get latest Amazon Linux 2023 AMI
    const ami = ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.X86_64,
    });

    // Create ES Search Head instance
    this.esSearchHead = new ec2.Instance(this, 'EsSearchHead', {
      vpc,
      instanceType: new ec2.InstanceType(config.esSearchHeadInstanceType),
      machineImage: ami,
      securityGroup: splunkSecurityGroup,
      role: esSearchHeadRole,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      associatePublicIpAddress: true,
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
          volume: ec2.BlockDeviceVolume.ebs(config.esDataModelVolumeSize, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: config.enableEncryption,
          }),
        },
      ],
    });

    // Validate Splunk configuration
    SplunkDownloadHelper.validateConfig(config);

    // UserData for ES Search Head
    this.esSearchHead.userData.addCommands(
      '#!/bin/bash',
      '# Use set -e but with proper error handling for non-critical failures',
      'set -e',
      '',
      '# Define error handler',
      'handle_error() {',
      '  echo "ERROR: Command failed at line $1"',
      '  echo "Continuing with ES installation despite error..."',
      '}',
      '',
      '# Set trap for better error handling',
      'trap \'handle_error $LINENO\' ERR',
      '',
      'yum update -y',
      '# Fix curl package conflict in AL2023',
      'dnf swap -y curl-minimal curl || true',
      'yum install -y wget unzip jq',
      '',
      '# Create mount point for data models',
      'mkdir -p /opt/splunk/var/lib/splunk',
      'mkfs -t xfs /dev/xvdb || true',
      'mount /dev/xvdb /opt/splunk/var/lib/splunk',
      'echo "/dev/xvdb /opt/splunk/var/lib/splunk xfs defaults,nofail 0 2" >> /etc/fstab',
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
      'chown -R splunk:splunk /opt/splunk/var/lib/splunk',
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
      `sudo -u splunk /opt/splunk/bin/splunk edit cluster-config -mode searchhead -manager_uri https://${clusterManagerIp}:8089 -secret clustersecret -auth admin:$ADMIN_PASSWORD || echo "Failed to configure cluster mode"`,
      '',
      '# Web interface is already accessible on port 8000 without SSL',
      '# Skipping web-ssl configuration as the command syntax is incorrect',
      '',
      '# Create ES indexes (as splunk user)',
      'sudo -u splunk /opt/splunk/bin/splunk add index main -auth admin:$ADMIN_PASSWORD || true',
      'sudo -u splunk /opt/splunk/bin/splunk add index summary -auth admin:$ADMIN_PASSWORD || true',
      'sudo -u splunk /opt/splunk/bin/splunk add index risk -auth admin:$ADMIN_PASSWORD || true',
      'sudo -u splunk /opt/splunk/bin/splunk add index notable -auth admin:$ADMIN_PASSWORD || true',
      'sudo -u splunk /opt/splunk/bin/splunk add index threat_intel -auth admin:$ADMIN_PASSWORD || true',
      '',
      '# Create additional security indexes',
      'sudo -u splunk /opt/splunk/bin/splunk add index firewall -auth admin:$ADMIN_PASSWORD || true',
      'sudo -u splunk /opt/splunk/bin/splunk add index proxy -auth admin:$ADMIN_PASSWORD || true',
      'sudo -u splunk /opt/splunk/bin/splunk add index endpoint -auth admin:$ADMIN_PASSWORD || true',
      'sudo -u splunk /opt/splunk/bin/splunk add index authentication -auth admin:$ADMIN_PASSWORD || true',
      '',
      '# Configure data model acceleration (as splunk user)',
      'sudo -u splunk mkdir -p /opt/splunk/etc/apps/SA-Utils/local',
      'sudo -u splunk bash -c "cat > /opt/splunk/etc/apps/SA-Utils/local/datamodels.conf << EOF',
      '[Authentication]',
      'acceleration = 1',
      'acceleration.earliest_time = -7d',
      '',
      '[Network_Traffic]',
      'acceleration = 1',
      'acceleration.earliest_time = -7d',
      '',
      '[Web]',
      'acceleration = 1',
      'acceleration.earliest_time = -7d',
      '',
      '[Endpoint]',
      'acceleration = 1',
      'acceleration.earliest_time = -7d',
      'EOF"',
      '',
      '# === Configure ES Search Head as cluster-aware ===',
      'echo "=== Configuring ES Search Head as cluster-aware ==="',
      '',
      '# Configure this ES Search Head to be aware of the indexer cluster',
      'echo "Setting ES Search Head to cluster-aware mode..."',
      `sudo -u splunk /opt/splunk/bin/splunk edit cluster-config -mode searchhead -manager_uri https://${clusterManagerIp}:8089 -secret clustersecret -auth admin:$ADMIN_PASSWORD`,
      'if [ $? -eq 0 ]; then',
      '  echo "✅ ES Search Head configured as cluster-aware"',
      'else',
      '  echo "⚠️  Warning: Failed to configure ES Search Head as cluster-aware"',
      'fi',
      '',
      '# === Configure distributed search for all indexers ===',
      'echo "=== Configuring distributed search for all indexers ==="',
      '',
      '# Temporarily disable exit on error for distributed search configuration',
      'set +e',
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
      '# Configure license peer if license is enabled',
      ...config.enableLicenseInstall ? 
        LicenseHelper.generateLicensePeerScript(clusterManagerIp) : 
        [],
      '',
      '# Restart Splunk to ensure all configurations are loaded',
      'echo "=== Restarting Splunk after distributed search configuration ==="',
      'sudo -u splunk /opt/splunk/bin/splunk restart',
      '',
      '# Re-enable exit on error for critical sections',
      'set -e',
      '');

    // Add ES package download and installation if available
    if (esAsset && esPackageInfo) {
      this.esSearchHead.userData.addCommands(
        '',
        '# =====================================',
        '# Enterprise Security Installation',
        '# =====================================',
        '',
        '# Download ES package from S3',
        'echo "=== Downloading Enterprise Security package from S3 ==="',
        `ES_PACKAGE_URL="${esPackageS3Path}"`,
        `ES_PACKAGE_FILE="/tmp/${esPackageInfo.filename}"`,
        '',
        '# Download with retry logic',
        'DOWNLOAD_ATTEMPTS=0',
        'MAX_DOWNLOAD_ATTEMPTS=3',
        '',
        'while [ $DOWNLOAD_ATTEMPTS -lt $MAX_DOWNLOAD_ATTEMPTS ]; do',
        '  DOWNLOAD_ATTEMPTS=$((DOWNLOAD_ATTEMPTS + 1))',
        '  echo "Download attempt $DOWNLOAD_ATTEMPTS of $MAX_DOWNLOAD_ATTEMPTS..."',
        '  ',
        '  if aws s3 cp "$ES_PACKAGE_URL" "$ES_PACKAGE_FILE"; then',
        '    echo "✅ Successfully downloaded ES package"',
        '    break',
        '  else',
        '    echo "❌ Failed to download ES package (attempt $DOWNLOAD_ATTEMPTS)"',
        '    if [ $DOWNLOAD_ATTEMPTS -lt $MAX_DOWNLOAD_ATTEMPTS ]; then',
        '      echo "Retrying in 10 seconds..."',
        '      sleep 10',
        '    fi',
        '  fi',
        'done',
        '',
        '# Verify download',
        'if [ -f "$ES_PACKAGE_FILE" ]; then',
        '  echo "✅ ES package downloaded successfully: $(ls -lh $ES_PACKAGE_FILE)"',
        'else',
        '  echo "❌ Failed to download ES package after $MAX_DOWNLOAD_ATTEMPTS attempts"',
        'fi',
        '',
        ...ESDownloadHelper.generateInstallScript(config, `/tmp/${esPackageInfo.filename}`),
        '',
        ...ESDownloadHelper.generateHealthCheckScript(),
        '',
        '# Final status check',
        'echo "=== ES Installation Complete ==="',
        'if sudo -u splunk /opt/splunk/bin/splunk list app -auth admin:$ADMIN_PASSWORD | grep -q "SplunkEnterpriseSecuritySuite"; then',
        '  echo "✅ Enterprise Security is installed and active"',
        'else',
        '  echo "⚠️  Enterprise Security installation may have failed - check logs at /var/log/cloud-init-output.log"',
        'fi'
      );
    } else {
      this.esSearchHead.userData.addCommands(
        '',
        '# =====================================',
        '# Enterprise Security Not Available',
        '# =====================================',
        '',
        'echo "⚠️  WARNING: ES package not found in packages directory"',
        'echo ""',
        'echo "To install Enterprise Security manually after deployment:"',
        'echo "1. Download ES from https://splunkbase.splunk.com/app/263"',
        'echo "2. Copy to server: scp <es-package.tgz> ec2-user@<server-ip>:/tmp/"',
        'echo "3. Connect via Session Manager: aws ssm start-session --target $(ec2-metadata --instance-id | cut -d \\" \\" -f2)"',
        'echo "4. Install: sudo -u splunk /opt/splunk/bin/splunk install app /tmp/<es-package.tgz> -auth admin:<password>"',
        'echo "5. Restart: sudo -u splunk /opt/splunk/bin/splunk restart"',
        ''
      );
    }

    this.esSearchHead.userData.addCommands(
      '',
      '# Create deployment summary',
      'echo "=== Creating Deployment Summary ==="',
      'SUMMARY_FILE="/opt/splunk/deployment-summary.txt"',
      'echo "ES Search Head Deployment Summary - $(date)" | sudo tee $SUMMARY_FILE',
      'echo "========================================" | sudo tee -a $SUMMARY_FILE',
      '',
      '# Check Splunk status',
      'if pgrep -f splunkd > /dev/null; then',
      '  echo "✅ Splunk Status: Running" | sudo tee -a $SUMMARY_FILE',
      'else',
      '  echo "❌ Splunk Status: Not Running" | sudo tee -a $SUMMARY_FILE',
      'fi',
      '',
      '# Check ES installation',
      'if sudo -u splunk /opt/splunk/bin/splunk list app -auth admin:$ADMIN_PASSWORD 2>/dev/null | grep -q "SplunkEnterpriseSecuritySuite"; then',
      '  echo "✅ Enterprise Security: Installed" | sudo tee -a $SUMMARY_FILE',
      'else',
      '  echo "❌ Enterprise Security: Not Installed" | sudo tee -a $SUMMARY_FILE',
      'fi',
      '',
      '# Check distributed search',
      'SEARCH_SERVERS=$(sudo -u splunk /opt/splunk/bin/splunk list search-server -auth admin:$ADMIN_PASSWORD 2>/dev/null | grep -c "https://" || echo "0")',
      'echo "ℹ️  Distributed Search Servers: $SEARCH_SERVERS" | sudo tee -a $SUMMARY_FILE',
      '',
      'echo "========================================" | sudo tee -a $SUMMARY_FILE',
      'echo "Deployment logs: /var/log/cloud-init-output.log" | sudo tee -a $SUMMARY_FILE',
      'echo "Summary file: $SUMMARY_FILE" | sudo tee -a $SUMMARY_FILE',
      '',
      'echo "ES Search Head setup complete."'
    );

    // Create Elastic IP
    const eip = new ec2.CfnEIP(this, 'EsSearchHeadEIP', {
      domain: 'vpc',
      tags: [{
        key: 'Name',
        value: `${this.stackName}-EsSearchHead-EIP`,
      }],
    });

    // Associate Elastic IP with the instance
    new ec2.CfnEIPAssociation(this, 'EsSearchHeadEIPAssoc', {
      allocationId: eip.attrAllocationId,
      instanceId: this.esSearchHead.instanceId,
    });

    // Store Elastic IP
    this.elasticIp = eip.attrPublicIp;

    // Allow inbound traffic on port 8000 from anywhere (restrict in production)
    this.esSearchHead.connections.allowFromAnyIpv4(
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
    new cdk.CfnOutput(this, 'EsSearchHeadPrivateIp', {
      value: this.esSearchHead.instancePrivateIp,
      exportName: `${this.stackName}-EsSearchHeadIP`,
    });

    new cdk.CfnOutput(this, 'EsWebUrl', {
      value: `http://${this.elasticIp}:8000`,
      description: 'ES Search Head Web UI URL',
    });

    new cdk.CfnOutput(this, 'EsSearchHeadElasticIP', {
      value: this.elasticIp,
      description: 'Elastic IP address of the ES Search Head',
    });

    new cdk.CfnOutput(this, 'EsAdminSecretConsoleUrl', {
      value: `https://console.aws.amazon.com/secretsmanager/secret?name=${splunkAdminSecret.secretName}&region=${this.region}`,
      description: 'Direct link to the Splunk admin password in AWS Secrets Manager',
    });

    new cdk.CfnOutput(this, 'EsSearchHeadSessionManagerCommand', {
      value: `aws ssm start-session --target ${this.esSearchHead.instanceId}`,
      description: 'Command to connect to ES Search Head via Session Manager',
    });

    new cdk.CfnOutput(this, 'EsConfiguration', {
      value: `Instance Type: ${config.esSearchHeadInstanceType} | System Storage: 100GB | Data Model Storage: ${config.esDataModelVolumeSize}GB`,
      description: 'Enterprise Security configuration summary',
    });

    new cdk.CfnOutput(this, 'EsPackageStatus', {
      value: esAsset ? 'ES package will be automatically installed during deployment' : 'ES package not found - manual installation required',
      description: 'Enterprise Security package installation status',
    });

    // License status outputs
    new cdk.CfnOutput(this, 'EsSearchHeadLicenseStatus', {
      value: config.enableLicenseInstall ? 
        '✅ License enabled - ES Search Head configured as license peer to Cluster Manager' : 
        '⚠️ Using 60-day trial license (500MB/day)',
      description: 'Splunk Enterprise license status for ES Search Head',
    });

    new cdk.CfnOutput(this, 'EsSearchHeadLicenseCheckCommand', {
      value: `sudo -u splunk /opt/splunk/bin/splunk list licenses -auth admin:<password>`,
      description: 'Command to verify license status on ES Search Head',
    });
  }
}