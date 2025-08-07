# Deployment Options Guide

## Overview
This CDK stack now supports flexible deployment configuration through multiple methods:
- Command-line context parameters (`--context`)
- Environment variables
- Interactive prompts (with inquirer)
- npm scripts shortcuts

## Configuration Methods

### 1. Command-Line Context Parameters

The most flexible way to configure deployment:

```bash
# Basic deployment (trial license, no ES)
npx cdk deploy --all

# Deploy with Enterprise Security
npx cdk deploy --all --context enableES=true

# Deploy with license installation
npx cdk deploy --all --context enableLicense=true

# Deploy with both ES and license
npx cdk deploy --all \
  --context enableES=true \
  --context enableLicense=true

# Select deployment size
npx cdk deploy --all --context deploymentSize=medium  # 3 indexers
npx cdk deploy --all --context deploymentSize=large   # 6 indexers

# Skip confirmation prompt
npx cdk deploy --all --context skipConfirmation=true
```

### 2. Environment Variables

Set environment variables before deployment:

```bash
export ENABLE_ES=true
export ENABLE_LICENSE=true
export INDEXER_COUNT=5
export INDEXER_INSTANCE_TYPE=m7i.2xlarge
npx cdk deploy --all
```

### 3. NPM Scripts (Shortcuts)

Pre-configured deployment scenarios:

```bash
# Basic deployment (no ES, no license)
npm run deploy:basic

# Deploy with ES and license
npm run deploy:es

# Large scale deployment
npm run deploy:production

# Interactive deployment (requires inquirer)
npm run deploy:interactive
```

### 4. Interactive Deployment

For a guided deployment experience:

```bash
# First install inquirer (if not already installed)
npm install --save-dev inquirer@^8.0.0

# Run interactive deployment
npm run deploy:interactive
```

#### Interactive Deployment Features

1. **AWS Profile Selection**
   - Automatically detects available AWS profiles
   - Option to use environment variables
   - Profile is passed to CDK with `--profile` option

2. **Auto-approve Option**
   - Choose whether to auto-approve CloudFormation changes
   - When enabled, adds `--require-approval never` to CDK command
   - Useful for CI/CD pipelines or when changes are pre-reviewed

3. **Configuration Steps**
   - Select AWS profile
   - Choose whether to deploy Enterprise Security
   - Choose whether to install license
   - Select deployment size (Medium/Large)
   - Select AWS region
   - Option to auto-approve changes
   - Review configuration before deployment

The interactive mode will:
- **Select AWS Profile**: Choose from available AWS profiles or use environment variables
- **Auto-detect**: ES packages and license files
- **Configure options**: Guide you through all deployment options
- **Auto-approve**: Option to use `--require-approval never` for unattended deployments
- **Validate choices**: Ensure configuration is valid
- **Execute deployment**: Run CDK with selected configuration

## Available Options

| Option | Context Key | Environment Variable | Default | Description |
|--------|------------|---------------------|---------|-------------|
| Enterprise Security | `enableES` | `ENABLE_ES` | `false` | Deploy ES Search Head |
| License Installation | `enableLicense` | `ENABLE_LICENSE` | `false` | Install enterprise license |
| Indexer Count | `indexerCount` | `INDEXER_COUNT` | `3` | Number of indexers |
| Indexer Instance Type | `indexerInstanceType` | `INDEXER_INSTANCE_TYPE` | `m7i.xlarge` | EC2 instance type for indexers |
| Search Head Instance Type | `searchHeadInstanceType` | `SEARCH_HEAD_INSTANCE_TYPE` | `m7i.large` | EC2 instance type for search head |
| ES Search Head Instance Type | `esSearchHeadInstanceType` | `ES_SEARCH_HEAD_INSTANCE_TYPE` | `m7i.2xlarge` | EC2 instance type for ES search head |
| Skip Confirmation | `skipConfirmation` | `SKIP_CONFIRMATION` | `false` | Skip deployment confirmation prompt |

## File Requirements

### Enterprise Security Package
Place ES package in `packages/` directory:
- Download from: https://splunkbase.splunk.com/app/263
- Supported formats: `.tgz`, `.tar.gz`, `.spl`
- Example: `packages/splunk-enterprise-security_8.1.1.tgz`

### License File
Place license file in `licenses/` directory:
- Supported formats: `.license`, `.lic`
- Example: `licenses/Splunk.License`

## Configuration Display

When you run any CDK command, you'll see a configuration summary:

```
================================================================================
📋 Splunk Deployment Configuration Summary
================================================================================

🔧 Core Configuration:
  • Indexer Count: 3
  • Indexer Instance Type: m7i.xlarge
  • Search Head Instance Type: m7i.large

📦 Optional Components:
  • Enterprise Security: ✅ Enabled
    └─ ES Package: splunk-enterprise-security_8.1.1.tgz
    └─ ES Instance Type: m7i.2xlarge
  • License Installation: ✅ Enabled
    └─ License File: Splunk.License

================================================================================
```

## Validation

The deployment system automatically validates:
- ES package availability when ES is enabled
- License file availability when license installation is enabled
- Minimum indexer count (3)
- Instance type validity

Deployment will fail with clear error messages if validation fails.

## Examples

### Basic Deployment
```bash
npx cdk deploy --all
```

### Deployment with Enterprise Security
```bash
npx cdk deploy --all \
  --context enableES=true \
  --context enableLicense=true
```

### Large Scale Deployment
```bash
npx cdk deploy --all \
  --context enableES=true \
  --context enableLicense=true \
  --context deploymentSize=large \
  --context skipConfirmation=true
```

### CI/CD Pipeline
```bash
export ENABLE_ES=true
export ENABLE_LICENSE=true
export SKIP_CONFIRMATION=true
export INDEXER_COUNT=6
npx cdk deploy --all --require-approval never
```