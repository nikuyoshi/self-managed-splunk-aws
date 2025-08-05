#!/bin/bash
# Splunk on AWS Deployment Script
# This script helps deploy the Splunk cluster to AWS Oregon region (us-west-2)

set -e

# Enable error handling
trap 'echo "Error occurred at line $LINENO. Exit code: $?"' ERR

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Log file
LOG_FILE="deployment-$(date +%Y%m%d-%H%M%S).log"
echo "Deployment log will be saved to: $LOG_FILE"

# Function to log messages
log() {
    echo "$1" | tee -a "$LOG_FILE"
}

log "=== Splunk on AWS Deployment Script ==="
log "Started at: $(date)"
log ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    echo "Error: AWS CDK is not installed. Please install it with: npm install -g aws-cdk"
    exit 1
fi

# Check Node.js version
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    log "Node.js version: $NODE_VERSION"
    # Check if version is 20.x or 22.x
    if [[ ! "$NODE_VERSION" =~ ^v2[02]\. ]]; then
        echo -e "${YELLOW}Warning: Node.js $NODE_VERSION is not officially supported. Recommended versions are 20.x or 22.x${NC}"
    fi
else
    echo "Error: Node.js is not installed. Please install Node.js 20.x or 22.x"
    exit 1
fi

# Set default region to Oregon
export AWS_REGION=${AWS_REGION:-us-west-2}
log "Using AWS Region: $AWS_REGION"

# Check AWS authentication
log ""
log "Checking AWS authentication..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo "AWS authentication required. Please choose an option:"
    echo "1) Use AWS SSO"
    echo "2) Use AWS credentials"
    read -p "Enter your choice (1 or 2): " choice
    
    case $choice in
        1)
            read -p "Enter your SSO profile name: " profile_name
            aws sso login --profile "$profile_name"
            export AWS_PROFILE="$profile_name"
            ;;
        2)
            aws configure
            ;;
        *)
            echo "Invalid choice. Exiting."
            exit 1
            ;;
    esac
fi

# Set CDK environment variables
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=$AWS_REGION

echo ""
log "AWS Account: $CDK_DEFAULT_ACCOUNT"
log "AWS Region: $CDK_DEFAULT_REGION"
log ""

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    log "Installing dependencies..."
    npm install 2>&1 | tee -a "$LOG_FILE"
fi

# Build the project
log "Building TypeScript project..."
npm run build 2>&1 | tee -a "$LOG_FILE"

# Ask about Enterprise Security
echo ""
read -p "Do you want to deploy Enterprise Security (ES)? (y/n): " deploy_es

# Check for ES package if ES deployment is requested
if [ "$deploy_es" == "y" ] || [ "$deploy_es" == "Y" ]; then
    echo ""
    echo "Checking for Enterprise Security package..."
    if [ ! -f "packages/"*.tgz ] && [ ! -f "packages/"*.tar.gz ] && [ ! -f "packages/"*.spl ]; then
        echo ""
        echo "==========================================================================="
        echo "⚠️  ERROR: Enterprise Security package not found!"
        echo "==========================================================================="
        echo ""
        echo "Please download ES package before deployment:"
        echo "1. Download ES from https://splunkbase.splunk.com/app/263"
        echo "2. Place the file in: $(pwd)/packages/"
        echo "3. Example filename: splunk-es-8.1.1.tgz"
        echo ""
        echo "==========================================================================="
        echo ""
        exit 1
    else
        echo "✅ ES package found: $(ls packages/*.tgz packages/*.tar.gz packages/*.spl 2>/dev/null | head -1)"
    fi
fi

# Bootstrap CDK if needed
echo ""
echo "Checking CDK bootstrap status..."
if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION &> /dev/null; then
    log "Bootstrapping CDK..."
    npx cdk bootstrap $PROFILE_OPT 2>&1 | tee -a "$LOG_FILE"
fi

# Deploy stacks
echo ""
echo "Starting deployment..."
echo "This may take 15-20 minutes..."
echo ""

# Add profile option if AWS_PROFILE is set
PROFILE_OPT=""
if [ -n "$AWS_PROFILE" ]; then
    PROFILE_OPT="--profile $AWS_PROFILE"
    log "Using AWS profile: $AWS_PROFILE"
fi

if [ "$deploy_es" == "y" ] || [ "$deploy_es" == "Y" ]; then
    log "Deploying with Enterprise Security enabled..."
    npx cdk deploy --all --context enableES=true --require-approval never $PROFILE_OPT 2>&1 | tee -a "$LOG_FILE"
else
    log "Deploying basic Splunk cluster..."
    npx cdk deploy --all --require-approval never $PROFILE_OPT 2>&1 | tee -a "$LOG_FILE"
fi

# Check deployment status
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment successful!"
else
    echo ""
    echo "❌ Deployment failed. Please check the error messages above."
    exit 1
fi

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""

# Get and display all URLs
echo -e "${GREEN}Splunk Access URLs:${NC}"
echo ""

# Search Head URL
SEARCH_HEAD_URL=$(aws cloudformation describe-stacks --stack-name SelfManagedSplunk-SearchHead --query 'Stacks[0].Outputs[?OutputKey==`SplunkWebUrl`].OutputValue' --output text 2>/dev/null || echo "Not deployed")
if [ "$SEARCH_HEAD_URL" != "Not deployed" ]; then
    echo "  Search Head Web UI: $SEARCH_HEAD_URL"
fi

# ES URL if deployed
if [ "$deploy_es" == "y" ] || [ "$deploy_es" == "Y" ]; then
    ES_URL=$(aws cloudformation describe-stacks --stack-name SelfManagedSplunk-ES --query 'Stacks[0].Outputs[?OutputKey==`EsWebUrl`].OutputValue' --output text 2>/dev/null || echo "Not deployed")
    if [ "$ES_URL" != "Not deployed" ]; then
        echo "  Enterprise Security: $ES_URL"
    fi
fi

# Cluster Manager URL
CLUSTER_MANAGER_URL=$(aws cloudformation describe-stacks --stack-name SelfManagedSplunk-IndexerCluster --query 'Stacks[0].Outputs[?OutputKey==`ClusterManagerWebUrl`].OutputValue' --output text 2>/dev/null || echo "Not available")
if [ "$CLUSTER_MANAGER_URL" != "Not available" ]; then
    echo "  Cluster Manager: $CLUSTER_MANAGER_URL (VPC internal only)"
fi

echo ""
echo -e "${GREEN}Access Credentials:${NC}"
echo "  Username: admin"
echo ""

# Get admin password
SECRET_ARN=$(aws cloudformation describe-stacks --stack-name SelfManagedSplunk-IndexerCluster --query 'Stacks[0].Outputs[?OutputKey==`SplunkAdminSecretArn`].OutputValue' --output text 2>/dev/null)
if [ -n "$SECRET_ARN" ] && [ "$SECRET_ARN" != "None" ]; then
    ADMIN_PASSWORD=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query 'SecretString' --output text 2>/dev/null | jq -r '.password' 2>/dev/null || echo "Unable to retrieve")
    if [ "$ADMIN_PASSWORD" != "Unable to retrieve" ]; then
        echo "  Password: $ADMIN_PASSWORD"
    else
        echo "  Password: Run the following command to retrieve:"
        echo "    aws secretsmanager get-secret-value --secret-id $SECRET_ARN --query 'SecretString' --output text | jq -r '.password'"
    fi
    
    # Direct link to Secrets Manager
    SECRETS_URL=$(aws cloudformation describe-stacks --stack-name SelfManagedSplunk-IndexerCluster --query 'Stacks[0].Outputs[?OutputKey==`SplunkAdminSecretConsoleUrl`].OutputValue' --output text 2>/dev/null)
    if [ -n "$SECRETS_URL" ] && [ "$SECRETS_URL" != "None" ]; then
        echo ""
        echo "  Or view in AWS Console: $SECRETS_URL"
    fi
fi

echo ""
echo -e "${GREEN}Next Steps:${NC}"
echo "  1. Wait 2-3 minutes for Splunk services to fully start"
echo "  2. Access the Search Head Web UI using the URL above"
echo "  3. Login with username 'admin' and the password shown above"
if [ "$deploy_es" == "y" ] || [ "$deploy_es" == "Y" ]; then
    echo "  4. For Enterprise Security, access via the /es path"
    echo "     Note: ES package installation may be required if not auto-installed"
fi

echo ""
echo -e "${YELLOW}To destroy all resources later:${NC}"
echo "  npx cdk destroy --all"

echo ""
echo -e "${GREEN}Running deployment health checks...${NC}"

# Health check function
check_url_health() {
    local url=$1
    local description=$2
    local max_attempts=30
    local attempt=1
    
    echo -n "  Checking $description: "
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -qE "^(200|301|302|303)"; then
            echo -e "${GREEN}✓ OK${NC}"
            return 0
        fi
        
        if [ $attempt -eq 1 ]; then
            echo -n "waiting"
        else
            echo -n "."
        fi
        
        sleep 10
        ((attempt++))
    done
    
    echo -e " ${RED}✗ FAILED${NC}"
    echo "    WARNING: $description is not responding after $((max_attempts * 10)) seconds"
    echo "    Please check CloudWatch logs for details"
    return 1
}

# Check Search Head
if [ "$SEARCH_HEAD_URL" != "Not deployed" ]; then
    check_url_health "$SEARCH_HEAD_URL" "Search Head"
fi

# Check ES if deployed
if [ "$deploy_es" == "y" ] || [ "$deploy_es" == "Y" ]; then
    if [ "$ES_URL" != "Not deployed" ]; then
        check_url_health "$ES_URL" "Enterprise Security"
    fi
fi

echo ""
echo -e "${GREEN}Deployment health check complete!${NC}"