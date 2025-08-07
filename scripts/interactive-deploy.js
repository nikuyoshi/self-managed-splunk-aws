#!/usr/bin/env node
/**
 * Interactive Deployment Script for Splunk CDK Stack
 * 
 * This script provides an interactive prompt-based deployment experience.
 * Install inquirer first: npm install --save-dev inquirer@^8.0.0
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Check if inquirer is installed
let inquirer;
try {
  inquirer = require('inquirer');
} catch (error) {
  console.error('❌ inquirer is not installed.');
  console.error('Please install it first: npm install --save-dev inquirer@^8.0.0');
  process.exit(1);
}

// Helper function to check if file exists
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

// Helper function to find files in directory
function findFiles(dir, pattern) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter(file => pattern.test(file));
}

// Helper function to get AWS profiles
function getAWSProfiles() {
  try {
    // Try to get profiles from AWS CLI config
    const configOutput = execSync('aws configure list-profiles', { encoding: 'utf-8' });
    const profiles = configOutput.trim().split('\n').filter(p => p);
    return profiles.length > 0 ? profiles : ['default'];
  } catch (error) {
    // If command fails, return default
    return ['default'];
  }
}

// Main interactive deployment function
async function interactiveDeploy() {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 Splunk Enterprise on AWS - Interactive Deployment');
  console.log('='.repeat(80) + '\n');

  // Check for ES package
  const packagesDir = path.join(process.cwd(), 'packages');
  const esPackages = findFiles(packagesDir, /splunk-(es-|enterprise-security).*\.(tgz|tar\.gz|spl)$/i);
  const hasESPackage = esPackages.length > 0;

  // Check for license files
  const licensesDir = path.join(process.cwd(), 'licenses');
  const licenseFiles = findFiles(licensesDir, /\.(license|lic)$/i);
  const hasLicense = licenseFiles.length > 0;

  // Get available AWS profiles
  const availableProfiles = getAWSProfiles();
  
  // Interactive questions
  const questions = [
    {
      type: 'list',
      name: 'awsProfile',
      message: 'Select AWS profile:',
      choices: [
        ...availableProfiles.map(profile => ({ 
          name: profile === 'default' ? 'default (Use current AWS credentials)' : profile, 
          value: profile 
        })),
        { name: 'Skip (Use environment variables)', value: null }
      ],
      default: availableProfiles.includes('default') ? 'default' : availableProfiles[0]
    },
    {
      type: 'confirm',
      name: 'enableES',
      message: 'Do you want to deploy Enterprise Security (ES)?',
      default: hasESPackage,
      when: () => {
        if (hasESPackage) {
          console.log(`  ✅ ES package found: ${esPackages[0]}`);
        } else {
          console.log('  ⚠️  No ES package found in packages/');
        }
        return true;
      }
    },
    {
      type: 'confirm',
      name: 'continueWithoutES',
      message: 'ES package not found. Continue without ES?',
      default: true,
      when: (answers) => answers.enableES && !hasESPackage
    },
    {
      type: 'confirm',
      name: 'enableLicense',
      message: 'Do you want to install an Enterprise license?',
      default: hasLicense,
      when: () => {
        if (hasLicense) {
          console.log(`  ✅ License file found: ${licenseFiles[0]}`);
        } else {
          console.log('  ⚠️  No license file found in licenses/');
        }
        return true;
      }
    },
    {
      type: 'list',
      name: 'deploymentSize',
      message: 'Select deployment size:',
      choices: [
        { name: 'Medium - 3 indexers, RF=3, SF=2, m7i.xlarge', value: 'medium' },
        { name: 'Large - 6 indexers, RF=3, SF=2, m7i.2xlarge', value: 'large' }
      ],
      default: 'medium'
    },
    {
      type: 'list',
      name: 'region',
      message: 'Select AWS region:',
      choices: [
        { name: 'US West (Oregon) - us-west-2 [Recommended]', value: 'us-west-2' },
        { name: 'US East (N. Virginia) - us-east-1', value: 'us-east-1' },
        { name: 'US East (Ohio) - us-east-2', value: 'us-east-2' },
        { name: 'EU (Ireland) - eu-west-1', value: 'eu-west-1' },
        { name: 'EU (Frankfurt) - eu-central-1', value: 'eu-central-1' },
        { name: 'Asia Pacific (Tokyo) - ap-northeast-1', value: 'ap-northeast-1' },
        { name: 'Asia Pacific (Singapore) - ap-southeast-1', value: 'ap-southeast-1' },
      ],
      default: 'us-west-2'
    },
    {
      type: 'confirm',
      name: 'autoApprove',
      message: 'Auto-approve all changes without confirmation? (--require-approval never)',
      default: false
    },
    {
      type: 'confirm',
      name: 'reviewConfig',
      message: 'Review configuration before deployment?',
      default: true
    },
    {
      type: 'confirm',
      name: 'proceedWithDeployment',
      message: 'Proceed with deployment?',
      default: true,
      when: (answers) => {
        if (answers.reviewConfig) {
          displayConfiguration(answers);
        }
        return true;
      }
    }
  ];

  // Ask questions
  const answers = await inquirer.prompt(questions);

  // Handle ES without package
  if (answers.enableES && !hasESPackage && !answers.continueWithoutES) {
    console.log('\n❌ Deployment cancelled. Please add ES package to packages/ directory.');
    process.exit(0);
  }

  // Proceed with deployment
  if (answers.proceedWithDeployment) {
    await deployStack(answers);
  } else {
    console.log('\n❌ Deployment cancelled by user.');
  }
}

// Display configuration summary
function displayConfiguration(config) {
  console.log('\n' + '='.repeat(80));
  console.log('📋 Deployment Configuration Summary');
  console.log('='.repeat(80));
  console.log(`\n🔑 AWS Profile: ${config.awsProfile || 'Using environment variables'}`);
  console.log(`🌍 Region: ${config.region}`);
  console.log(`⚡ Auto-approve: ${config.autoApprove ? '✅ Yes (--require-approval never)' : '❌ No (manual approval required)'}`);
  console.log(`\n📦 Components:`);
  console.log(`  • Enterprise Security: ${config.enableES ? '✅ Yes' : '❌ No'}`);
  console.log(`  • Enterprise License: ${config.enableLicense ? '✅ Yes' : '❌ No'}`);
  console.log(`\n🖥️  Deployment Size: ${config.deploymentSize ? config.deploymentSize.toUpperCase() : 'MEDIUM'}`);
  
  // Display configuration based on deployment size
  const sizeConfigs = {
    medium: { indexers: 3, rf: 3, sf: 2, indexerType: 'm7i.xlarge', shType: 'm7i.large', esType: 'm7i.2xlarge' },
    large: { indexers: 6, rf: 3, sf: 2, indexerType: 'm7i.2xlarge', shType: 'm7i.xlarge', esType: 'm7i.4xlarge' }
  };
  const selectedSize = sizeConfigs[config.deploymentSize || 'medium'];
  console.log(`  • Indexer Count: ${selectedSize.indexers}`);
  console.log(`  • Replication Factor: ${selectedSize.rf}`);
  console.log(`  • Search Factor: ${selectedSize.sf}`);
  console.log(`  • Indexer Type: ${selectedSize.indexerType}`);
  console.log(`  • Search Head Type: ${selectedSize.shType}`);
  if (config.enableES) {
    console.log(`  • ES Search Head Type: ${selectedSize.esType}`);
  }
  console.log('\n' + '='.repeat(80));
}

// Deploy the stack with the given configuration
async function deployStack(config) {
  console.log('\n🚀 Starting deployment...\n');

  // Build CDK command arguments
  const args = ['cdk', 'deploy', '--all'];
  
  // Add profile if specified
  if (config.awsProfile) {
    args.push('--profile', config.awsProfile);
  }
  
  // Add auto-approve if specified
  if (config.autoApprove) {
    args.push('--require-approval', 'never');
  }
  
  // Add context parameters
  args.push('--context', `enableES=${config.enableES}`);
  args.push('--context', `enableLicense=${config.enableLicense}`);
  args.push('--context', `deploymentSize=${config.deploymentSize || 'medium'}`);
  args.push('--context', 'skipConfirmation=true');

  // Set environment variables
  const env = {
    ...process.env,
    CDK_DEFAULT_REGION: config.region,
    AWS_REGION: config.region
  };
  
  // Add profile to environment if specified
  if (config.awsProfile) {
    env.AWS_PROFILE = config.awsProfile;
  }

  console.log(`Executing: npx ${args.join(' ')}`);
  console.log(`Profile: ${config.awsProfile || 'Using environment variables'}`);
  console.log(`Region: ${config.region}\n`);

  // Execute CDK deploy
  const child = spawn('npx', args, {
    env,
    stdio: 'inherit',
    shell: true
  });

  child.on('error', (error) => {
    console.error(`\n❌ Deployment failed: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log('\n✅ Deployment completed successfully!');
      displayPostDeploymentInfo(config);
    } else {
      console.error(`\n❌ Deployment failed with exit code ${code}`);
      process.exit(code);
    }
  });
}

// Display post-deployment information
function displayPostDeploymentInfo(config) {
  console.log('\n' + '='.repeat(80));
  console.log('📌 Post-Deployment Information');
  console.log('='.repeat(80));
  console.log('\n🔗 Access URLs:');
  console.log('  Check CloudFormation outputs for:');
  console.log('  • Search Head URL');
  if (config.enableES) {
    console.log('  • ES Search Head URL');
  }
  console.log('  • Admin password location in Secrets Manager');
  console.log('\n📝 Next Steps:');
  console.log('  1. Retrieve admin password from AWS Secrets Manager');
  console.log('  2. Access Search Head Web UI');
  console.log('  3. Configure data inputs');
  if (config.enableES) {
    console.log('  4. Complete ES initial setup');
  }
  console.log('\n' + '='.repeat(80));
}

// Run the interactive deployment
interactiveDeploy().catch((error) => {
  console.error(`\n❌ Error: ${error.message}`);
  process.exit(1);
});