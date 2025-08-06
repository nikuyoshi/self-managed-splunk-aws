#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { SplunkClusterStack } from '../lib/splunk-cluster-stack';
import { SplunkSearchStack } from '../lib/splunk-search-stack';
import { SplunkEsStack } from '../lib/splunk-es-stack';
import { SplunkDataIngestionStack } from '../lib/splunk-data-ingestion-stack';
import { defaultConfig, configWithES } from '../config/splunk-config';
import { ESDownloadHelper } from '../lib/utils/es-download-helper';

const app = new cdk.App();

// Set AWS environment
// Note: This deployment is optimized for us-west-2 (Oregon) region
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-west-2',
};

// Determine which configuration to use based on context or environment variable
const enableES = app.node.tryGetContext('enableES') === 'true' || 
                process.env.ENABLE_ES === 'true';
const config = enableES ? configWithES : defaultConfig;

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
    
    console.log('Enterprise Security stack will be deployed');
  } catch (error) {
    console.error('Failed to create ES stack:', error);
    process.exit(1);
  }
} else {
  console.log('Enterprise Security is disabled. To enable, use: --context enableES=true');
}