#!/bin/bash

# 1. Load variables from .env
if [ -f .env ]; then
    set -a
    source .env
    set +a
else
    echo "❌ Error: .env file not found in $(pwd)"
    exit 1
fi

# 2. Configuration
FUNCTION_NAME="vybn-razorpay-lambda"
ZIP_FILE="vybn-razorpay-lambda.zip"

echo "📦 Zipping index.mjs..."
zip -j $ZIP_FILE index.mjs

# 3. Deploy
# Check if function exists
aws lambda get-function --function-name $FUNCTION_NAME > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "🆙 Updating existing function: $FUNCTION_NAME..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://$ZIP_FILE \
        --no-cli-pager
    
    echo "⚙️  Updating environment variables..."
    aws lambda update-function-configuration \
        --function-name $FUNCTION_NAME \
        --no-cli-pager \
        --environment "Variables={RAZORPAY_KEY_ID=\"$RAZORPAY_KEY_ID\",RAZORPAY_KEY_SECRET=\"$RAZORPAY_KEY_SECRET\"}"
else
    echo "✨ Creating new function: $FUNCTION_NAME..."
    if [ -z "$LAMBDA_ROLE_ARN" ]; then
        echo "❌ Error: LAMBDA_ROLE_ARN not found in .env. Needed for first-time creation."
        exit 1
    fi

    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime nodejs20.x \
        --role $LAMBDA_ROLE_ARN \
        --handler index.handler \
        --zip-file fileb://$ZIP_FILE \
        --timeout 30 \
        --no-cli-pager \
        --environment "Variables={RAZORPAY_KEY_ID=\"$RAZORPAY_KEY_ID\",RAZORPAY_KEY_SECRET=\"$RAZORPAY_KEY_SECRET\"}"
fi

echo "✅ Deployment complete!"

# 4. Clean up
rm -f $ZIP_FILE
