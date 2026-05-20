# Standalone Razorpay Payment — AWS Lambda Function

This standalone AWS Lambda function handles all direct integrations with the Razorpay REST API, keeping the primary NestJS API modular, lightweight, and completely independent of third-party payment gateway SDKs.

---

## Supported Actions

The Lambda function routes operations based on the `"action"` parameter in the incoming event.

### 1. `create_order`
Initiates a new Razorpay order.
- **Payload Schema**:
  ```json
  {
    "action": "create_order",
    "payload": {
      "amount": 50000,      // Required. Amount in paise (smallest currency unit)
      "currency": "INR",    // Optional. Defaults to "INR"
      "receipt": "ORD-1234" // Required. Custom merchant receipt ID
    }
  }
  ```
- **Response Schema (`data` property)**:
  ```json
  {
    "id": "order_EK9218318",
    "entity": "order",
    "amount": 50000,
    "amount_paid": 0,
    "amount_due": 50000,
    "currency": "INR",
    "receipt": "ORD-1234",
    "status": "created",
    "attempts": 0,
    "notes": [],
    "created_at": 1716000000
  }
  ```

---

### 2. `verify_signature`
Cryptographically verifies payment signature using SHA-256 HMAC.
- **Payload Schema**:
  ```json
  {
    "action": "verify_signature",
    "payload": {
      "razorpayOrderId": "order_EK9218318",
      "razorpayPaymentId": "pay_xyz",
      "razorpaySignature": "signature_hash"
    }
  }
  ```
- **Response Schema (`data` property)**:
  ```json
  {
    "verified": true
  }
  ```

---

### 3. `create_refund`
Initiates a payment refund via the Razorpay API.
- **Payload Schema**:
  ```json
  {
    "action": "create_refund",
    "payload": {
      "paymentId": "pay_xyz",
      "amount": 25000 // Optional. Amount in paise. If not specified, performs full refund.
    }
  }
  ```

---

## Standard Response Structure

Every response returned by this Lambda follows this standard envelope format:

```json
{
  "success": true,
  "action": "create_order",
  "data": { ...action-specific fields... }
}
```

If an action fails, it returns:

```json
{
  "success": false,
  "action": "create_order",
  "error": "Error message description"
}
```

---

## Local Development and Configuration

### Environment Variables
Create a `.env` file in this directory with the following variables:

```ini
RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_key_secret
RAZORPAY_ENV=production
LAMBDA_ROLE_ARN=arn:aws:iam::123456789012:role/service-role/your-lambda-execution-role
```

---

## Deployment

Deploy this Lambda to AWS using the included deployment script:

```bash
chmod +x deploy.sh
./deploy.sh
```

The script automatically:
1. Zips `index.mjs`.
2. Checks if `vybn-razorpay-lambda` exists in AWS.
3. If it exists, updates the code and configurations.
4. If it doesn't exist, creates the function with Node.js 20.x runtime, the specified `LAMBDA_ROLE_ARN` role, and default configuration.
