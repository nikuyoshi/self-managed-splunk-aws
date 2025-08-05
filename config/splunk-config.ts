/**
 * Splunk Enterprise on AWS Configuration
 * This file contains all configuration parameters for the Splunk deployment
 * 
 * Note: This deployment is optimized for us-west-2 (Oregon) region
 */

export interface SplunkConfig {
  // Network configuration
  vpcCidr: string;
  maxAzs: number;
  
  // Instance configuration
  indexerInstanceType: string;
  searchHeadInstanceType: string;
  esSearchHeadInstanceType: string;
  clusterManagerInstanceType: string;
  
  // Splunk configuration
  splunkVersion: string;
  splunkBuildId?: string;
  splunkDownloadUrl?: string;
  enableEnterpriseSecurity: boolean;
  
  // Enterprise Security configuration
  esVersion?: string;
  esPackageLocalPath?: string;  // ローカルファイルパス (例: ./packages/splunk-es-8.1.1.tgz)
  
  // Storage configuration
  indexerHotVolumeSize: number;  // GB
  indexerColdVolumeSize: number; // GB
  searchHeadVolumeSize: number;  // GB
  esDataModelVolumeSize: number; // GB
  
  // Cluster configuration
  replicationFactor: number;
  searchFactor: number;
  indexerCount: number;
  
  // Security configuration
  allowedIpRanges?: string[];
  enableEncryption: boolean;
  
  // Tags
  environment: string;
  project: string;
  dataClassification?: string;
  owner?: string;
  costCenter?: string;
}

// Common tags interface
export interface CommonTags {
  splunkit_environment_type: string;
  splunkit_data_classification: string;
  project?: string;
  owner?: string;
  costCenter?: string;
}

// Default configuration for MVP deployment
export const defaultConfig: SplunkConfig = {
  // Network
  vpcCidr: '10.0.0.0/16',
  maxAzs: 3,
  
  // Instances - Using M7i series for better performance (2025 recommendation)
  // M7i provides 1.75-2.2x better CPU performance than M5 with only 5% cost increase
  indexerInstanceType: 'm7i.xlarge',
  searchHeadInstanceType: 'm7i.large',
  esSearchHeadInstanceType: 'm7i.2xlarge',
  clusterManagerInstanceType: 'm7i.large',
  
  // Splunk version (fixed for MVP)
  splunkVersion: '10.0.0',
  splunkBuildId: 'e8eb0c4654f8',
  enableEnterpriseSecurity: false, // Set to true to deploy ES Search Head
  
  // Storage (minimal for MVP)
  indexerHotVolumeSize: 200,    // 200GB for hot data
  indexerColdVolumeSize: 500,   // 500GB for cold data
  searchHeadVolumeSize: 100,    // 100GB for search head
  esDataModelVolumeSize: 500,   // 500GB for ES data models
  
  // Cluster settings (SVA minimum)
  replicationFactor: 3,
  searchFactor: 2,
  indexerCount: 3,
  
  // Security
  enableEncryption: true,
  
  // Tags
  environment: 'development',
  project: 'splunk-cluster',
  dataClassification: 'sensitive',
  owner: 'platform-team'
};

// Default common tags
export const defaultTags: CommonTags = {
  splunkit_environment_type: 'non-prd',
  splunkit_data_classification: 'private',
  project: defaultConfig.project,
  owner: defaultConfig.owner
};

// Configuration with ES enabled
export const configWithES: SplunkConfig = {
  ...defaultConfig,
  enableEnterpriseSecurity: true,
};

// Production configuration example (for future use)
export const productionConfig: SplunkConfig = {
  ...defaultConfig,
  
  // Larger instances for production - M7i series
  indexerInstanceType: 'm7i.2xlarge',
  searchHeadInstanceType: 'm7i.xlarge',
  esSearchHeadInstanceType: 'm7i.4xlarge',
  clusterManagerInstanceType: 'm7i.large',
  
  // More storage for production
  indexerHotVolumeSize: 500,
  indexerColdVolumeSize: 1000,
  searchHeadVolumeSize: 200,
  esDataModelVolumeSize: 1000,
  
  // Production tags
  environment: 'production',
};