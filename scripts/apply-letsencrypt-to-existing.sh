#!/bin/bash
# Apply Let's Encrypt certificates to existing Splunk Search Head instances
#
# Runs locally. Auto-discovers instances from CloudFormation stack tags and
# applies Let's Encrypt certificates via SSM Run Command — no SSH required.
#
# Usage:
#   ./scripts/apply-letsencrypt-to-existing.sh --email your@example.com
#   ./scripts/apply-letsencrypt-to-existing.sh --email your@example.com --profile my-profile --region ap-northeast-1
#
# Requirements (local):
#   - AWS CLI
#   - jq
#
# Requirements (instances):
#   - SSM Agent running (default on Amazon Linux 2023)
#   - Python 3 (default on Amazon Linux 2023)
#   - IAM permissions: ec2:AuthorizeSecurityGroupIngress, ec2:RevokeSecurityGroupIngress

set -euo pipefail

# --------------------------------------------------------------------------
# Argument parsing
# --------------------------------------------------------------------------
PROFILE=""
REGION="us-west-2"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"

usage() {
    cat << EOF
Usage: $0 --email <email> [--profile <aws-profile>] [--region <region>]

Options:
  --email    Email for Let's Encrypt registration (required)
  --profile  AWS profile (optional; uses default credential chain if omitted)
  --region   AWS region (default: us-west-2)

Environment:
  LETSENCRYPT_EMAIL  Alternative way to supply the email address
EOF
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --email)   LETSENCRYPT_EMAIL="$2"; shift 2 ;;
        --profile) PROFILE="$2";           shift 2 ;;
        --region)  REGION="$2";            shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

[[ -z "$LETSENCRYPT_EMAIL" ]] && { echo "ERROR: --email is required."; echo; usage; }

# --------------------------------------------------------------------------
# Certificate setup script — embedded, executed on each instance via SSM
# --------------------------------------------------------------------------
# shellcheck disable=SC2016
CERT_SCRIPT=$(cat << 'CERT_EOF'
#!/bin/bash
set -e

echo "=== Setting up Let's Encrypt certificate with sslip.io ==="

if [ "$EUID" -ne 0 ]; then
    echo "Please run as root or with sudo"
    exit 1
fi

if [ -z "$LETSENCRYPT_EMAIL" ]; then
    echo "ERROR: LETSENCRYPT_EMAIL is not set"
    exit 1
fi

# Instance metadata
INSTANCE_ID=$(curl -sf http://169.254.169.254/latest/meta-data/instance-id)
PUBLIC_IP=$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4)
REGION=$(curl -sf http://169.254.169.254/latest/meta-data/placement/region)
DOMAIN="${PUBLIC_IP//./-}.sslip.io"

echo "Instance ID : $INSTANCE_ID"
echo "Public IP   : $PUBLIC_IP"
echo "Domain      : $DOMAIN"
echo "Email       : $LETSENCRYPT_EMAIL"

# Install certbot if missing
if ! command -v certbot &>/dev/null; then
    echo "Installing certbot..."
    dnf install -y python3 python3-pip 2>/dev/null || yum install -y python3 python3-pip
    python3 -m pip install --quiet certbot
    ln -sf /usr/local/bin/certbot /usr/bin/certbot 2>/dev/null || true
fi

# Check port 80 availability
if ss -tlnp 2>/dev/null | grep -q ':80 '; then
    echo "ERROR: Port 80 is already in use — Let's Encrypt requires port 80 for HTTP-01 challenge"
    exit 1
fi

# Temporarily open port 80 in the security group
SG_ID=$(aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" --region "$REGION" \
    --query "Reservations[0].Instances[0].SecurityGroups[0].GroupId" \
    --output text)

PORT80_ADDED=false
RULE_EXISTS=$(aws ec2 describe-security-groups \
    --group-ids "$SG_ID" --region "$REGION" \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`80\`]" \
    --output text)

if [ -z "$RULE_EXISTS" ]; then
    echo "Opening port 80 temporarily for Let's Encrypt challenge..."
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" --protocol tcp --port 80 --cidr 0.0.0.0/0 \
        --region "$REGION" && PORT80_ADDED=true
fi

# Stop Splunk before obtaining certificate
echo "Stopping Splunk..."
sudo -u splunk /opt/splunk/bin/splunk stop || true

# Obtain certificate
echo "Obtaining Let's Encrypt certificate for $DOMAIN..."
certbot certonly --standalone \
    -d "$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "$LETSENCRYPT_EMAIL" \
    --preferred-challenges http \
    --http-01-port 80
CERT_EXIT=$?

# Remove temporary port 80 rule
if [ "$PORT80_ADDED" = true ]; then
    echo "Closing temporary port 80..."
    aws ec2 revoke-security-group-ingress \
        --group-id "$SG_ID" --protocol tcp --port 80 --cidr 0.0.0.0/0 \
        --region "$REGION" 2>/dev/null || true
fi

if [ "$CERT_EXIT" -ne 0 ]; then
    echo "ERROR: Failed to obtain Let's Encrypt certificate"
    sudo -u splunk /opt/splunk/bin/splunk start || true
    exit 1
fi

# Fix certificate permissions so splunk user can read private key
chmod 644 /etc/letsencrypt/archive/"$DOMAIN"/privkey*.pem

# Create symlinks accessible to splunk user
mkdir -p /opt/splunk/etc/auth/letsencrypt
ln -sf /etc/letsencrypt/live/"$DOMAIN"/privkey.pem \
    /opt/splunk/etc/auth/letsencrypt/privkey.pem
ln -sf /etc/letsencrypt/live/"$DOMAIN"/fullchain.pem \
    /opt/splunk/etc/auth/letsencrypt/fullchain.pem
chown -R splunk:splunk /opt/splunk/etc/auth/letsencrypt

# Configure Splunk web.conf for HTTPS
echo "Configuring Splunk for HTTPS on port 8443..."
sudo -u splunk tee /opt/splunk/etc/system/local/web.conf > /dev/null << EOF
[settings]
enableSplunkWebSSL = true
httpport = 8443
privKeyPath = /opt/splunk/etc/auth/letsencrypt/privkey.pem
serverCert = /opt/splunk/etc/auth/letsencrypt/fullchain.pem
sslVersions = tls1.2
cipherSuite = ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256
EOF

# Start Splunk
echo "Starting Splunk..."
sudo -u splunk /opt/splunk/bin/splunk start
sleep 30

# Verify HTTPS
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN:8443" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" =~ ^(200|302|303)$ ]]; then
    echo "✅ HTTPS verified (HTTP $HTTP_CODE)"
else
    echo "⚠️  Could not verify HTTPS (HTTP $HTTP_CODE). Check /opt/splunk/var/log/splunk/splunkd.log"
fi

# Set up auto-renewal cron (fix permissions + restart on renewal)
cat > /etc/cron.d/certbot-splunk << EOF
0 0,12 * * * root certbot renew --quiet \
    --deploy-hook "chmod 644 /etc/letsencrypt/archive/*/privkey*.pem && sudo -u splunk /opt/splunk/bin/splunk restart"
EOF

echo ""
echo "✅ Done! Access Splunk at: https://$DOMAIN:8443"
echo "   Certificate auto-renews every 90 days."
CERT_EOF
)

# Base64-encode the embedded script for safe SSM transmission
CERT_SCRIPT_B64=$(printf '%s' "$CERT_SCRIPT" | base64 | tr -d '\n')

# --------------------------------------------------------------------------
# AWS CLI options
# --------------------------------------------------------------------------
AWS_OPTS=("--region" "$REGION")
[[ -n "$PROFILE" ]] && AWS_OPTS+=("--profile" "$PROFILE")

# --------------------------------------------------------------------------
# Instance discovery via CloudFormation stack tags
# --------------------------------------------------------------------------
get_instance_id() {
    aws ec2 describe-instances \
        --filters \
            "Name=tag:aws:cloudformation:stack-name,Values=${1}" \
            "Name=instance-state-name,Values=running" \
        --query "Reservations[0].Instances[0].InstanceId" \
        --output text "${AWS_OPTS[@]}" 2>/dev/null || true
}

get_public_ip() {
    aws ec2 describe-instances \
        --instance-ids "$1" \
        --query "Reservations[0].Instances[0].PublicIpAddress" \
        --output text "${AWS_OPTS[@]}" 2>/dev/null || true
}

echo "=== Applying Let's Encrypt certificates to existing Splunk instances ==="
echo ""
echo "Discovering Search Head instances..."

SH_INSTANCE_ID=$(get_instance_id "SelfManagedSplunk-SearchHead")
ES_INSTANCE_ID=$(get_instance_id "SelfManagedSplunk-ES")

[[ -z "$SH_INSTANCE_ID" || "$SH_INSTANCE_ID" == "None" ]] && SH_INSTANCE_ID=""
[[ -z "$ES_INSTANCE_ID" || "$ES_INSTANCE_ID" == "None" ]] && ES_INSTANCE_ID=""

[[ -n "$SH_INSTANCE_ID" ]] \
    && echo "  Search Head:    $SH_INSTANCE_ID" \
    || echo "  Search Head:    not found (SelfManagedSplunk-SearchHead stack)"
[[ -n "$ES_INSTANCE_ID" ]] \
    && echo "  ES Search Head: $ES_INSTANCE_ID" \
    || echo "  ES Search Head: not deployed (SelfManagedSplunk-ES stack)"
echo ""

# --------------------------------------------------------------------------
# Send certificate setup script to instance via SSM Run Command
# --------------------------------------------------------------------------
apply_cert() {
    local INSTANCE_ID=$1 INSTANCE_NAME=$2
    [[ -z "$INSTANCE_ID" ]] && { echo "Skipping $INSTANCE_NAME: instance not found"; return; }

    echo "Processing $INSTANCE_NAME ($INSTANCE_ID)..."

    # Build SSM parameters JSON via jq (handles all escaping safely)
    local DECODE_CMD="python3 -c \"import base64,os; open('/tmp/enable-letsencrypt.sh','wb').write(base64.b64decode('${CERT_SCRIPT_B64}')); os.chmod('/tmp/enable-letsencrypt.sh',0o755)\""
    local RUN_CMD="sudo LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL} /tmp/enable-letsencrypt.sh"

    local PARAMS_JSON
    PARAMS_JSON=$(jq -cn \
        --arg decode "$DECODE_CMD" \
        --arg run "$RUN_CMD" \
        '{"commands": [$decode, $run]}')

    aws ssm send-command \
        --document-name "AWS-RunShellScript" \
        --instance-ids "$INSTANCE_ID" \
        --parameters "$PARAMS_JSON" \
        "${AWS_OPTS[@]}" \
        --output json > /tmp/ssm-cmd-"${INSTANCE_ID}".json

    local COMMAND_ID
    COMMAND_ID=$(jq -r '.Command.CommandId' /tmp/ssm-cmd-"${INSTANCE_ID}".json)
    echo "  Command ID: $COMMAND_ID (waiting for completion...)"

    local STATUS
    for i in {1..30}; do
        STATUS=$(aws ssm get-command-invocation \
            --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
            "${AWS_OPTS[@]}" --query 'Status' --output text 2>/dev/null || echo "Pending")
        case "$STATUS" in
            Success)
                echo "  ✅ $INSTANCE_NAME: certificate applied"
                return 0
                ;;
            Failed|Cancelled|TimedOut)
                echo "  ❌ $INSTANCE_NAME: failed (status: $STATUS)"
                echo "     Check with: aws ssm get-command-invocation \\"
                echo "       --command-id $COMMAND_ID --instance-id $INSTANCE_ID ${AWS_OPTS[*]}"
                return 1
                ;;
        esac
        echo "  Status: $STATUS ... ($i/30)"
        sleep 10
    done
    echo "  ⚠️  $INSTANCE_NAME: timed out"
}

[[ -n "$SH_INSTANCE_ID" ]] && apply_cert "$SH_INSTANCE_ID" "Search Head"
[[ -n "$ES_INSTANCE_ID" ]] && apply_cert "$ES_INSTANCE_ID" "ES Search Head"

# --------------------------------------------------------------------------
# Display access URLs
# --------------------------------------------------------------------------
echo ""
echo "=== All Done ==="
echo ""
echo "Access your Splunk instances at:"

if [[ -n "$SH_INSTANCE_ID" ]]; then
    SH_IP=$(get_public_ip "$SH_INSTANCE_ID")
    [[ -n "$SH_IP" && "$SH_IP" != "None" ]] \
        && echo "  Search Head:    https://${SH_IP//./-}.sslip.io:8443"
fi
if [[ -n "$ES_INSTANCE_ID" ]]; then
    ES_IP=$(get_public_ip "$ES_INSTANCE_ID")
    [[ -n "$ES_IP" && "$ES_IP" != "None" ]] \
        && echo "  ES Search Head: https://${ES_IP//./-}.sslip.io:8443"
fi
echo ""
echo "Certificates auto-renew every 90 days."
