/**
 * Deployment Options Manager for Splunk CDK Stack
 * 
 * This utility provides multiple methods for configuring deployment options:
 * 1. Command-line context parameters (--context)
 * 2. Environment variables
 * 3. Interactive prompts (requires inquirer)
 * 4. Configuration file (cdk.json context)
 */

import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { SplunkConfig, defaultConfig } from '../../config/splunk-config';

export interface DeploymentOptions {
  enableEnterpriseSecurity: boolean;
  enableLicenseInstall: boolean;
  esPackagePath?: string;
  licensePath?: string;
  indexerCount?: number;
  indexerInstanceType?: string;
  searchHeadInstanceType?: string;
  esSearchHeadInstanceType?: string;
  skipConfirmation?: boolean;
}

export class DeploymentOptionsManager {
  private app: cdk.App;
  private options: DeploymentOptions;

  constructor(app: cdk.App) {
    this.app = app;
    this.options = this.collectOptions();
  }

  /**
   * Collect deployment options from various sources in priority order:
   * 1. Command-line context (--context)
   * 2. Environment variables
   * 3. cdk.json context
   * 4. Default values
   */
  private collectOptions(): DeploymentOptions {
    const options: DeploymentOptions = {
      // ES configuration
      enableEnterpriseSecurity: this.getBooleanOption('enableES', 'ENABLE_ES', false),
      
      // License configuration
      enableLicenseInstall: this.getBooleanOption('enableLicense', 'ENABLE_LICENSE', false),
      
      // Instance configuration
      indexerCount: this.getNumberOption('indexerCount', 'INDEXER_COUNT', defaultConfig.indexerCount),
      
      // Instance types
      indexerInstanceType: this.getStringOption('indexerInstanceType', 'INDEXER_INSTANCE_TYPE', defaultConfig.indexerInstanceType),
      searchHeadInstanceType: this.getStringOption('searchHeadInstanceType', 'SEARCH_HEAD_INSTANCE_TYPE', defaultConfig.searchHeadInstanceType),
      esSearchHeadInstanceType: this.getStringOption('esSearchHeadInstanceType', 'ES_SEARCH_HEAD_INSTANCE_TYPE', defaultConfig.esSearchHeadInstanceType),
      
      // Skip confirmation prompt
      skipConfirmation: this.getBooleanOption('skipConfirmation', 'SKIP_CONFIRMATION', false),
    };

    // Check for ES package if ES is enabled
    if (options.enableEnterpriseSecurity) {
      options.esPackagePath = this.findESPackage();
    }

    // Check for license file if license installation is enabled
    if (options.enableLicenseInstall) {
      options.licensePath = this.findLicenseFile();
    }

    return options;
  }

  /**
   * Get boolean option from context or environment
   */
  private getBooleanOption(contextKey: string, envKey: string, defaultValue: boolean): boolean {
    // Check command-line context first
    const contextValue = this.app.node.tryGetContext(contextKey);
    if (contextValue !== undefined) {
      return contextValue === 'true' || contextValue === true;
    }

    // Check environment variable
    const envValue = process.env[envKey];
    if (envValue !== undefined) {
      return envValue.toLowerCase() === 'true';
    }

    return defaultValue;
  }

  /**
   * Get string option from context or environment
   */
  private getStringOption(contextKey: string, envKey: string, defaultValue?: string): string | undefined {
    return this.app.node.tryGetContext(contextKey) || 
           process.env[envKey] || 
           defaultValue;
  }

  /**
   * Get number option from context or environment
   */
  private getNumberOption(contextKey: string, envKey: string, defaultValue?: number): number | undefined {
    const value = this.app.node.tryGetContext(contextKey) || process.env[envKey];
    if (value !== undefined) {
      const num = parseInt(value, 10);
      return isNaN(num) ? defaultValue : num;
    }
    return defaultValue;
  }

  /**
   * Find ES package in the packages directory
   */
  private findESPackage(): string | undefined {
    const packagesDir = path.join(process.cwd(), 'packages');
    if (!fs.existsSync(packagesDir)) {
      return undefined;
    }

    const files = fs.readdirSync(packagesDir);
    const esPackage = files.find(file => 
      /splunk-(es-|enterprise-security).*\.(tgz|tar\.gz|spl)$/i.test(file)
    );

    return esPackage ? path.join(packagesDir, esPackage) : undefined;
  }

  /**
   * Find license file in the licenses directory
   */
  private findLicenseFile(): string | undefined {
    const licensesDir = path.join(process.cwd(), 'licenses');
    if (!fs.existsSync(licensesDir)) {
      return undefined;
    }

    const files = fs.readdirSync(licensesDir);
    const licenseFile = files.find(file => 
      /\.(license|lic)$/i.test(file)
    );

    return licenseFile ? path.join(licensesDir, licenseFile) : undefined;
  }

  /**
   * Display deployment configuration summary
   */
  public displaySummary(): void {
    console.log('\n' + '='.repeat(80));
    console.log('📋 Splunk Deployment Configuration Summary');
    console.log('='.repeat(80));
    
    console.log('\n🔧 Core Configuration:');
    console.log(`  • Indexer Count: ${this.options.indexerCount}`);
    console.log(`  • Indexer Instance Type: ${this.options.indexerInstanceType}`);
    console.log(`  • Search Head Instance Type: ${this.options.searchHeadInstanceType}`);
    
    console.log('\n📦 Optional Components:');
    console.log(`  • Enterprise Security: ${this.options.enableEnterpriseSecurity ? '✅ Enabled' : '❌ Disabled'}`);
    if (this.options.enableEnterpriseSecurity) {
      if (this.options.esPackagePath) {
        console.log(`    └─ ES Package: ${path.basename(this.options.esPackagePath)}`);
      } else {
        console.log(`    └─ ⚠️  ES Package not found in packages/`);
      }
      console.log(`    └─ ES Instance Type: ${this.options.esSearchHeadInstanceType}`);
    }
    
    console.log(`  • License Installation: ${this.options.enableLicenseInstall ? '✅ Enabled' : '❌ Disabled'}`);
    if (this.options.enableLicenseInstall) {
      if (this.options.licensePath) {
        console.log(`    └─ License File: ${path.basename(this.options.licensePath)}`);
      } else {
        console.log(`    └─ ⚠️  License file not found in licenses/`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
  }

  /**
   * Validate deployment options and show warnings
   */
  public validate(): boolean {
    let isValid = true;
    const warnings: string[] = [];
    const errors: string[] = [];

    // Check ES package
    if (this.options.enableEnterpriseSecurity && !this.options.esPackagePath) {
      errors.push('Enterprise Security is enabled but no ES package found in packages/');
      errors.push('Please download ES from https://splunkbase.splunk.com/app/263');
      isValid = false;
    }

    // Check license file
    if (this.options.enableLicenseInstall && !this.options.licensePath) {
      warnings.push('License installation is enabled but no license file found in licenses/');
      warnings.push('Deployment will continue with trial license');
    }

    // Check instance counts
    if (this.options.indexerCount && this.options.indexerCount < 3) {
      warnings.push(`Indexer count (${this.options.indexerCount}) is less than recommended minimum (3)`);
    }

    // Display warnings and errors
    if (warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      warnings.forEach(w => console.log(`   • ${w}`));
    }

    if (errors.length > 0) {
      console.log('\n❌ Errors:');
      errors.forEach(e => console.log(`   • ${e}`));
    }

    return isValid;
  }

  /**
   * Get the final configuration object
   */
  public getConfiguration(): SplunkConfig {
    return {
      ...defaultConfig,
      enableEnterpriseSecurity: this.options.enableEnterpriseSecurity,
      enableLicenseInstall: this.options.enableLicenseInstall,
      indexerCount: this.options.indexerCount || defaultConfig.indexerCount,
      indexerInstanceType: this.options.indexerInstanceType || defaultConfig.indexerInstanceType,
      searchHeadInstanceType: this.options.searchHeadInstanceType || defaultConfig.searchHeadInstanceType,
      esSearchHeadInstanceType: this.options.esSearchHeadInstanceType || defaultConfig.esSearchHeadInstanceType,
      esPackageLocalPath: this.options.esPackagePath,
      licensePackageLocalPath: this.options.licensePath,
    };
  }

  /**
   * Get deployment options
   */
  public getOptions(): DeploymentOptions {
    return this.options;
  }

  /**
   * Check if confirmation should be skipped
   */
  public shouldSkipConfirmation(): boolean {
    return this.options.skipConfirmation || false;
  }
}

/**
 * Usage examples for different deployment scenarios
 */
export const USAGE_EXAMPLES = `
Deployment Examples:
====================

1. Basic deployment (trial license, no ES):
   npx cdk deploy --all

2. Deploy with Enterprise Security:
   npx cdk deploy --all --context enableES=true

3. Deploy with license installation:
   npx cdk deploy --all --context enableLicense=true

4. Deploy with both ES and license:
   npx cdk deploy --all --context enableES=true --context enableLicense=true

5. Custom instance configuration:
   npx cdk deploy --all \\
     --context indexerCount=5 \\
     --context indexerInstanceType=m7i.2xlarge

6. Skip confirmation prompt:
   npx cdk deploy --all --context skipConfirmation=true

7. Using environment variables:
   export ENABLE_ES=true
   export ENABLE_LICENSE=true
   export INDEXER_COUNT=5
   npx cdk deploy --all

8. Production deployment:
   npx cdk deploy --all \\
     --context enableES=true \\
     --context enableLicense=true \\
     --context indexerCount=6 \\
     --context indexerInstanceType=m7i.2xlarge \\
     --context searchHeadInstanceType=m7i.xlarge \\
     --context esSearchHeadInstanceType=m7i.4xlarge
`;