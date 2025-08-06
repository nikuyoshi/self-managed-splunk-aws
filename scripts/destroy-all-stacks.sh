#!/bin/bash

# Script to destroy all CDK stacks in reverse dependency order
# Usage: ./destroy-all-stacks.sh [--profile <aws-profile>] [--yes]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
PROFILE=""
AUTO_CONFIRM=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --profile)
            PROFILE="--profile $2"
            shift 2
            ;;
        --yes|-y)
            AUTO_CONFIRM=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--profile <aws-profile>] [--yes]"
            echo "Options:"
            echo "  --profile <profile>  AWS profile to use"
            echo "  --yes, -y           Skip confirmation prompt"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--profile <aws-profile>] [--yes]"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}🗑️  Starting CDK stack destruction...${NC}"
echo

# Define CDK stack names (static list from bin/self-managed-splunk-aws.ts)
# These are the only stacks managed by this repository
CDK_STACKS=(
    "SelfManagedSplunk-Network"
    "SelfManagedSplunk-IndexerCluster"
    "SelfManagedSplunk-SearchHead"
    "SelfManagedSplunk-DataIngestion"
    "SelfManagedSplunk-ES"
)

# Check which CDK stacks actually exist on AWS
echo -e "${BLUE}📋 Checking for CDK-managed stacks...${NC}"
ACTIVE_STACKS=""
for stack_name in "${CDK_STACKS[@]}"; do
    STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" $PROFILE \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        # Stack exists
        ACTIVE_STACKS="$ACTIVE_STACKS $stack_name"
    fi
done

# Trim leading/trailing spaces
ACTIVE_STACKS=$(echo "$ACTIVE_STACKS" | xargs)

if [ -z "$ACTIVE_STACKS" ]; then
    echo -e "${GREEN}✅ No CDK-managed stacks found to destroy.${NC}"
    exit 0
fi

# Convert to array
read -ra STACK_ARRAY <<< "$ACTIVE_STACKS"

echo -e "${YELLOW}Found ${#STACK_ARRAY[@]} CDK-managed stack(s):${NC}"
for stack in "${STACK_ARRAY[@]}"; do
    # Get stack status and creation time
    STACK_INFO=$(aws cloudformation describe-stacks \
        --stack-name "$stack" $PROFILE \
        --query 'Stacks[0].[StackStatus,CreationTime]' \
        --output text 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        IFS=$'\t' read -r STATUS CREATED <<< "$STACK_INFO"
        echo -e "  ${BLUE}•${NC} $stack (Status: $STATUS, Created: $CREATED)"
    fi
done
echo

# Define static deletion order based on CDK dependencies
# ES and SearchHead depend on IndexerCluster
# IndexerCluster imports from DataIngestion (target groups)
# DataIngestion depends on Network
# Therefore: ES -> SearchHead -> IndexerCluster -> DataIngestion -> Network
DELETION_ORDER=()

# Build deletion order only for existing stacks
for stack_name in "SelfManagedSplunk-ES" "SelfManagedSplunk-SearchHead" "SelfManagedSplunk-IndexerCluster" "SelfManagedSplunk-DataIngestion" "SelfManagedSplunk-Network"; do
    if [[ " $ACTIVE_STACKS " =~ " $stack_name " ]]; then
        DELETION_ORDER+=("$stack_name")
    fi
done

if [ ${#DELETION_ORDER[@]} -gt 0 ]; then
    echo -e "${GREEN}✅ Deletion order (based on dependencies):${NC}"
    for i in "${!DELETION_ORDER[@]}"; do
        echo -e "  ${BLUE}$((i+1)).${NC} ${DELETION_ORDER[$i]}"
    done
    echo
fi

# Confirmation prompt
if [ "$AUTO_CONFIRM" = false ]; then
    echo -e "${YELLOW}⚠️  WARNING: This will permanently delete the above stacks and all their resources!${NC}"
    read -p "Are you sure you want to proceed? (yes/no): " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy][Ee]?[Ss]?$ ]]; then
        echo -e "${RED}❌ Deletion cancelled by user${NC}"
        exit 0
    fi
fi

echo
echo -e "${BLUE}🚀 Starting deletion process...${NC}"
echo

# Process stacks in order
for stack_name in "${DELETION_ORDER[@]}"; do
    # Check if this stack currently exists (dynamic check)
    CURRENT_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" $PROFILE \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null)
    
    if [ $? -ne 0 ]; then
        echo -e "${BLUE}ℹ️  Stack $stack_name does not exist or already deleted, skipping...${NC}"
        continue
    fi
    
    if [[ "$CURRENT_STATUS" == "CREATE_COMPLETE" ]] || [[ "$CURRENT_STATUS" == "UPDATE_COMPLETE" ]] || [[ "$CURRENT_STATUS" == "UPDATE_ROLLBACK_COMPLETE" ]]; then
        echo -e "${YELLOW}🔄 Deleting stack: $stack_name (current status: $CURRENT_STATUS)${NC}"
        
        # Delete the stack
        DELETE_OUTPUT=$(aws cloudformation delete-stack --stack-name "$stack_name" $PROFILE 2>&1)
        DELETE_STATUS=$?
        
        if [ $DELETE_STATUS -eq 0 ]; then
            echo "⏳ Waiting for deletion to complete..."
            
            # Wait for deletion with timeout handling
            set +e  # Temporarily disable exit on error
            timeout_seconds=900  # 15 minutes timeout
            start_time=$(date +%s)
            deletion_started=false
            
            while true; do
                # Check stack status
                STACK_STATUS=$(aws cloudformation describe-stacks \
                    --stack-name "$stack_name" $PROFILE \
                    --query 'Stacks[0].StackStatus' \
                    --output text 2>/dev/null)
                
                if [ $? -ne 0 ]; then
                    # Stack not found = successfully deleted
                    echo -e "${GREEN}✅ Successfully deleted: $stack_name${NC}"
                    break
                fi
                
                # Check if deletion has actually started
                if [[ "$STACK_STATUS" == "DELETE_IN_PROGRESS" ]]; then
                    deletion_started=true
                elif [[ "$STACK_STATUS" == "CREATE_COMPLETE" ]] || [[ "$STACK_STATUS" == "UPDATE_COMPLETE" ]]; then
                    if [ "$deletion_started" = false ]; then
                        # Deletion hasn't started yet, retry the delete command
                        echo ""
                        echo "⚠️  Stack deletion hasn't started. Retrying delete command..."
                        aws cloudformation delete-stack --stack-name "$stack_name" $PROFILE 2>&1
                        deletion_started=true
                        sleep 5
                        continue
                    fi
                fi
                
                # Check for timeout
                current_time=$(date +%s)
                elapsed=$((current_time - start_time))
                if [ $elapsed -gt $timeout_seconds ]; then
                    echo "⚠️  Timeout waiting for deletion of: $stack_name"
                    echo "    Stack status: $STACK_STATUS"
                    
                    if [[ "$STACK_STATUS" == "DELETE_IN_PROGRESS" ]]; then
                        echo "    Stack is still deleting. Giving additional 5 minutes..."
                        additional_wait=300  # 5 more minutes
                        additional_start=$(date +%s)
                        
                        while [ $(($(date +%s) - additional_start)) -lt $additional_wait ]; do
                            STACK_STATUS=$(aws cloudformation describe-stacks \
                                --stack-name "$stack_name" $PROFILE \
                                --query 'Stacks[0].StackStatus' \
                                --output text 2>/dev/null)
                            
                            if [ $? -ne 0 ]; then
                                echo "✅ Successfully deleted: $stack_name (completed during extended wait)"
                                break 2  # Break out of both loops
                            fi
                            
                            echo -n "+"
                            sleep 15
                        done
                        
                        # Final check after additional wait
                        STACK_STATUS=$(aws cloudformation describe-stacks \
                            --stack-name "$stack_name" $PROFILE \
                            --query 'Stacks[0].StackStatus' \
                            --output text 2>/dev/null)
                        
                        if [ $? -ne 0 ]; then
                            echo "✅ Successfully deleted: $stack_name (completed after extended wait)"
                            break
                        else
                            echo ""
                            echo "    Stack still exists after additional wait. Status: $STACK_STATUS"
                        fi
                    elif [[ "$STACK_STATUS" == "CREATE_COMPLETE" ]] || [[ "$STACK_STATUS" == "UPDATE_COMPLETE" ]]; then
                        echo "    Stack deletion was not initiated. You may need to manually delete this stack."
                    fi
                    echo "    Continuing with next stack..."
                    break
                fi
                
                # Show progress
                echo -n "."
                sleep 10
            done
            set -e  # Re-enable exit on error
            echo
        else
            echo -e "${RED}❌ Failed to delete: $stack_name${NC}"
            echo "    Error: $DELETE_OUTPUT"
            
            # Check if it's a dependency issue
            if [[ "$DELETE_OUTPUT" == *"Export"* ]] || [[ "$DELETE_OUTPUT" == *"imported"* ]]; then
                echo -e "    ${YELLOW}💡 Tip: This might be a dependency issue. The script will retry dependent stacks.${NC}"
            fi
            
            echo "    Continuing with next stack..."
        fi
        echo
    elif [[ "$CURRENT_STATUS" == "DELETE_IN_PROGRESS" ]]; then
        echo "ℹ️  Stack $stack_name is already being deleted, monitoring progress..."
        
        # Monitor the already in-progress deletion
        set +e
        start_time=$(date +%s)
        timeout_seconds=900  # 15 minutes timeout
        
        while true; do
            STACK_STATUS=$(aws cloudformation describe-stacks \
                --stack-name "$stack_name" $PROFILE \
                --query 'Stacks[0].StackStatus' \
                --output text 2>/dev/null)
            
            if [ $? -ne 0 ]; then
                echo "✅ Successfully deleted: $stack_name"
                break
            fi
            
            # Check for timeout
            current_time=$(date +%s)
            elapsed=$((current_time - start_time))
            if [ $elapsed -gt $timeout_seconds ]; then
                echo "⚠️  Timeout monitoring deletion of: $stack_name"
                echo "    Stack status: $STACK_STATUS"
                echo "    Continuing with next stack..."
                break
            fi
            
            echo -n "."
            sleep 10
        done
        set -e
        echo
    else
        echo "ℹ️  Stack $stack_name has status: $CURRENT_STATUS, skipping..."
    fi
done

# Final check for remaining CDK stacks
echo -e "${BLUE}📋 Final verification...${NC}"

# Check only for CDK-managed stacks
REMAINING_STACKS=""
for stack_name in "${CDK_STACKS[@]}"; do
    STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" $PROFILE \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null)
    
    if [ $? -eq 0 ] && [[ "$STATUS" != "DELETE_COMPLETE" ]]; then
        REMAINING_STACKS="$REMAINING_STACKS\n$stack_name ($STATUS)"
    fi
done

# Trim leading newline
REMAINING_STACKS=$(echo -e "$REMAINING_STACKS" | sed '/^$/d')

if [ -z "$REMAINING_STACKS" ]; then
    echo -e "${GREEN}🎉 All CDK-managed stacks destroyed successfully!${NC}"
else
    echo -e "${YELLOW}⚠️  Some stacks may still be deleting or require manual intervention:${NC}"
    echo "$REMAINING_STACKS" | while IFS= read -r line; do
        [ -n "$line" ] && echo -e "    ${RED}•${NC} $line"
    done
    echo
    echo -e "${BLUE}Recommendations:${NC}"
    echo "  1. Wait a few minutes and run this script again"
    echo "  2. Check AWS Console for any deletion errors"
    echo "  3. For stacks with DELETE_FAILED status, check CloudFormation events for details"
    echo "  4. To manually delete a specific stack:"
    echo -e "     ${YELLOW}aws cloudformation delete-stack --stack-name <stack-name> $PROFILE${NC}"
fi