#!/bin/bash

# Script to destroy all CDK stacks in reverse dependency order
# Usage: ./destroy-all-stacks.sh [--profile <aws-profile>]

set -e

# Default values
PROFILE=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --profile)
            PROFILE="--profile $2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--profile <aws-profile>]"
            exit 1
            ;;
    esac
done

echo "🗑️  Starting stack destruction..."
echo

# Get list of all active stacks from CloudFormation
echo "📋 Checking for active stacks..."
ACTIVE_STACKS=$(aws cloudformation list-stacks \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
    --query 'StackSummaries[?contains(StackName, `SelfManagedSplunk`)].StackName' \
    --output text $PROFILE)

if [ -z "$ACTIVE_STACKS" ]; then
    echo "✅ No active stacks found to destroy."
    exit 0
fi

# Convert to array
IFS=$'\t' read -ra STACK_ARRAY <<< "$ACTIVE_STACKS"

echo "Found ${#STACK_ARRAY[@]} active stack(s):"
for stack in "${STACK_ARRAY[@]}"; do
    echo "  - $stack"
done
echo

# Define the correct deletion order (most dependent first)
# ES and SearchHead depend on IndexerCluster
# IndexerCluster imports target groups from DataIngestion
# DataIngestion depends on Network
# Therefore: ES -> SearchHead -> IndexerCluster -> DataIngestion -> Network
DELETION_ORDER=(
    "SelfManagedSplunk-ES"
    "SelfManagedSplunk-SearchHead"
    "SelfManagedSplunk-IndexerCluster"
    "SelfManagedSplunk-DataIngestion"
    "SelfManagedSplunk-Network"
)

# Process stacks in order
for stack_name in "${DELETION_ORDER[@]}"; do
    # Check if this stack currently exists (dynamic check)
    CURRENT_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" $PROFILE \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null)
    
    if [ $? -ne 0 ]; then
        echo "ℹ️  Stack $stack_name does not exist or already deleted, skipping..."
        continue
    fi
    
    if [[ "$CURRENT_STATUS" == "CREATE_COMPLETE" ]] || [[ "$CURRENT_STATUS" == "UPDATE_COMPLETE" ]]; then
        echo "🔄 Deleting stack: $stack_name (current status: $CURRENT_STATUS)"
        
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
                    echo "✅ Successfully deleted: $stack_name"
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
            echo "❌ Failed to delete: $stack_name"
            echo "    Error: $DELETE_OUTPUT"
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

# Final check for remaining stacks
echo "📋 Final check..."
REMAINING_STACKS=$(aws cloudformation list-stacks \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE DELETE_IN_PROGRESS \
    --query 'StackSummaries[?contains(StackName, `SelfManagedSplunk`)].StackName' \
    --output text $PROFILE)

if [ -z "$REMAINING_STACKS" ]; then
    echo "🎉 All stacks destroyed successfully!"
else
    echo "⚠️  Some stacks may still be deleting or require manual intervention:"
    echo "$REMAINING_STACKS" | tr '\t' '\n' | sed 's/^/    - /'
    echo
    echo "Recommendations:"
    echo "  1. Wait a few minutes and run this script again"
    echo "  2. Check AWS Console for any deletion errors"
    echo "  3. If a stack is stuck in CREATE_COMPLETE, manually run:"
    echo "     aws cloudformation delete-stack --stack-name <stack-name> $PROFILE"
fi