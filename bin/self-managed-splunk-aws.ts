#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { SplunkClusterStack } from '../lib/splunk-cluster-stack';
import { SplunkSearchStack } from '../lib/splunk-search-stack';
import { SplunkEsStack } from '../lib/splunk-es-stack';
import { SplunkDataIngestionStack } from '../lib/splunk-data-ingestion-stack';
import { ESDownloadHelper } from '../lib/utils/es-download-helper';
import { DeploymentOptionsManager, USAGE_EXAMPLES } from '../lib/utils/deployment-options';

const app = new cdk.App();

// Set AWS environment
// Note: This deployment is optimized for us-west-2 (Oregon) region
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
};

// Initialize deployment options manager
const optionsManager = new DeploymentOptionsManager(app);

// Display configuration summary
optionsManager.displaySummary();

// Validate configuration
if (!optionsManager.validate()) {
  console.error('\n❌ Deployment validation failed. Please fix the errors above.');
  console.log(USAGE_EXAMPLES);
  process.exit(1);
}

// Get the final configuration
const config = optionsManager.getConfiguration();
const options = optionsManager.getOptions();

// Confirmation prompt (can be skipped with --context skipConfirmation=true)
if (!optionsManager.shouldSkipConfirmation()) {
  console.log('\n⚠️  To proceed with deployment, use the CDK deploy command.');
  console.log('   To skip this message, add: --context skipConfirmation=true');
}

// Create Network Stack
const networkStack = new NetworkStack(app, 'SelfManagedSplunk-Network', {
  env,
  config,
  description: 'Splunk Enterprise Network Infrastructure',
});

// Create Splunk Indexer Cluster Stack
const indexerClusterStack = new SplunkClusterStack(app, 'SelfManagedSplunk-IndexerCluster', {
  env,
  config,
  vpc: networkStack.vpc,
  securityGroup: networkStack.splunkClusterSecurityGroup,
  description: 'Splunk Enterprise Indexer Cluster (Cluster Manager + Indexers)',
});

// Add dependency
indexerClusterStack.addDependency(networkStack);

// Create Search Head Stack
const searchHeadStack = new SplunkSearchStack(app, 'SelfManagedSplunk-SearchHead', {
  env,
  config,
  vpc: networkStack.vpc,
  splunkSecurityGroup: networkStack.splunkClusterSecurityGroup,
  clusterManagerIp: indexerClusterStack.clusterManager.instancePrivateIp,
  splunkAdminSecret: indexerClusterStack.splunkAdminSecret,
  description: 'Splunk Enterprise Search Head with Elastic IP',
});

// Add dependencies
searchHeadStack.addDependency(networkStack);
searchHeadStack.addDependency(indexerClusterStack);

// Get optional domain configuration for HTTPS
const domainName = app.node.tryGetContext('domainName') || process.env.HEC_DOMAIN_NAME;
const hostedZoneId = app.node.tryGetContext('hostedZoneId') || process.env.HEC_HOSTED_ZONE_ID;

// Create Data Ingestion Stack (NLB for S2S and HEC)
const dataIngestionStack = new SplunkDataIngestionStack(app, 'SelfManagedSplunk-DataIngestion', {
  env,
  config,
  vpc: networkStack.vpc,
  indexerAsg: indexerClusterStack.indexerAsg,
  splunkSecurityGroup: networkStack.splunkClusterSecurityGroup,
  domainName,
  hostedZoneId,
  description: 'Splunk Data Ingestion Infrastructure (NLB for S2S and HEC with optional HTTPS)',
});

// Add dependencies - NetworkStack only to avoid circular dependency
// IndexerClusterStack dependency is implicit through the ASG reference
dataIngestionStack.addDependency(networkStack);

// Conditionally create ES Search Head Stack
if (config.enableEnterpriseSecurity) {
  try {
    // Validate ES package availability before creating stack
    ESDownloadHelper.validateConfig(config);
    
    const esStack = new SplunkEsStack(app, 'SelfManagedSplunk-ES', {
      env,
      config,
      vpc: networkStack.vpc,
      splunkSecurityGroup: networkStack.splunkClusterSecurityGroup,
      clusterManagerIp: indexerClusterStack.clusterManager.instancePrivateIp,
      splunkAdminSecret: indexerClusterStack.splunkAdminSecret,
      description: 'Splunk Enterprise Security Search Head with Elastic IP',
    });
    
    // Add dependencies
    esStack.addDependency(networkStack);
    esStack.addDependency(indexerClusterStack);
    esStack.addDependency(searchHeadStack);
    
    console.log('✅ Enterprise Security stack will be deployed');
  } catch (error) {
    console.error('Failed to create ES stack:', error);
    process.exit(1);
  }
} else {
  console.log('ℹ️  Enterprise Security is disabled. To enable: --context enableES=true');
}

// Display deployment information
console.log('\n📌 Deployment Information:');
console.log(`   • Region: ${env.region}`);
console.log(`   • Account: ${env.account || 'current'}`);
console.log(`   • Stacks to deploy: ${options.enableEnterpriseSecurity ? '5' : '4'}`);

// Display helpful commands
console.log('\n📝 Useful Commands:');
console.log('   • Deploy all stacks: npx cdk deploy --all');
console.log('   • Deploy specific stack: npx cdk deploy <stack-name>');
console.log('   • List all stacks: npx cdk list');
console.log('   • Show diff: npx cdk diff --all');
console.log('   • Destroy all: npx cdk destroy --all');