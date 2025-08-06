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

# Custom instance configuration
npx cdk deploy --all \
  --context indexerCount=5 \
  --context indexerInstanceType=m7i.2xlarge \
  --context searchHeadInstanceType=m7i.xlarge

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

# Production-sized deployment
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

The interactive mode will:
- Auto-detect ES packages and license files
- Guide you through configuration options
- Validate your choices
- Execute the deployment

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

### Development Environment
```bash
npx cdk deploy --all
```

### Testing Environment with ES
```bash
npx cdk deploy --all \
  --context enableES=true \
  --context enableLicense=true
```

### Production Environment
```bash
npx cdk deploy --all \
  --context enableES=true \
  --context enableLicense=true \
  --context indexerCount=6 \
  --context indexerInstanceType=m7i.2xlarge \
  --context searchHeadInstanceType=m7i.xlarge \
  --context esSearchHeadInstanceType=m7i.4xlarge \
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