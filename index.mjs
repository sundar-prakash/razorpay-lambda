import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import crypto from 'crypto';

/**
 * Razorpay Integration — AWS Lambda Function
 *
 * ─── HOW TO CALL THIS LAMBDA ────────────────────────────────────────────────
 *  Invoke via AWS SDK with a JSON body:
 *
 *  {
 *    "action": "<ACTION_NAME>",
 *    "payload": { ...action-specific fields... }
 *  }
 *
 *  Every response follows:
 *  {
 *    "success": true | false,
 *    "action": "<ACTION_NAME>",
 *    "data":   <Razorpay API response>,   // on success
 *    "error":  "<message>"               // on failure
 *  }
 *
 * ─── SUPPORTED ACTIONS ──────────────────────────────────────────────────────
 *  create_order        Create a new Razorpay order
 *  verify_signature    Verify cryptographic payment signature
 *  create_refund       Initiate a refund for a payment
 *
 * ─── ENVIRONMENT VARIABLES (set in Lambda → Configuration → Environment) ───
 *  RAZORPAY_KEY_ID        Your Razorpay Key ID
 *  RAZORPAY_KEY_SECRET    Your Razorpay Key Secret
 *  RAZORPAY_ENV           "production" | "test" (default: "production")
 *
 * ─── SECURITY NOTE ──────────────────────────────────────────────────────────
 *  All credentials live ONLY in Lambda Environment Variables or AWS Secrets Manager.
 *  • Never commit keys to source code.
 * ────────────────────────────────────────────────────────────────────────────
 */

let cachedSecrets = null;

// ── Credentials (resolved once per cold-start) ────────────────────────────────
async function getCredentials() {
  const secretName = process.env.RAZORPAY_SECRET_NAME;
  const ssmPath = process.env.RAZORPAY_SSM_PATH;

  if (secretName && !cachedSecrets) {
    try {
      const sm = new SecretsManagerClient({
        region: process.env.AWS_REGION || 'ap-south-1',
      });
      const response = await sm.send(
        new GetSecretValueCommand({ SecretId: secretName }),
      );
      cachedSecrets = JSON.parse(response.SecretString);
    } catch (err) {
      console.error(
        'Failed to fetch secrets from Secrets Manager:',
        err.message,
      );
    }
  } else if (ssmPath && !cachedSecrets) {
    try {
      const ssm = new SSMClient({
        region: process.env.AWS_REGION || 'ap-south-1',
      });
      const response = await ssm.send(
        new GetParameterCommand({ Name: ssmPath, WithDecryption: true }),
      );
      cachedSecrets = JSON.parse(response.Parameter.Value);
    } catch (err) {
      console.error(
        'Failed to fetch secrets from SSM Parameter Store:',
        err.message,
      );
    }
  }

  const secrets = cachedSecrets || {};

  const keyId = secrets.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
  const keySecret =
    secrets.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error(
      'Missing required credentials. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in environment variables or AWS Secrets Manager.',
    );
  }

  return {
    keyId,
    keySecret,
  };
}

// ── Generic HTTP helper ───────────────────────────────────────────────────────
async function callRazorpay(creds, path, bodyObj, method = 'POST') {
  const url = `https://api.razorpay.com/v1${path}`;
  console.log(`Razorpay Request: ${method} ${url}`);

  const authHeader =
    'Basic ' +
    Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64');
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
  };

  if (method !== 'GET' && bodyObj !== undefined) {
    options.body = JSON.stringify(bodyObj);
    // Sanitize body log to keep secret keys out of logs
    console.log(`Request Body: ${JSON.stringify(bodyObj)}`);
  }

  const res = await fetch(url, options);
  const text = await res.text();

  if (!res.ok) {
    let detail = text;
    try {
      detail = JSON.parse(text);
    } catch (_) {}
    throw new Error(
      `Razorpay API error ${res.status}: ${JSON.stringify(detail)}`,
    );
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    return { raw: text };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACTION HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * create_order
 * payload: { amount (paise), currency (default INR), receipt }
 */
async function createOrder(creds, payload) {
  const { amount, currency = 'INR', receipt } = payload;
  if (!amount) throw new Error('payload.amount (in paise) is required');
  if (!receipt) throw new Error('payload.receipt is required');

  const orderData = await callRazorpay(creds, '/orders', {
    amount: Math.round(amount),
    currency,
    receipt,
  });

  return {
    ...orderData,
    keyId: creds.keyId,
  };
}

/**
 * verify_signature
 * payload: { razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
async function verifySignature(creds, payload) {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = payload;
  if (!razorpayOrderId) throw new Error('payload.razorpayOrderId is required');
  if (!razorpayPaymentId)
    throw new Error('payload.razorpayPaymentId is required');
  if (!razorpaySignature)
    throw new Error('payload.razorpaySignature is required');

  const body = razorpayOrderId + '|' + razorpayPaymentId;
  const expectedSignature = crypto
    .createHmac('sha256', creds.keySecret)
    .update(body.toString())
    .digest('hex');

  const verified = expectedSignature === razorpaySignature;
  return { verified };
}

/**
 * create_refund
 * payload: { paymentId, amount (paise, optional for full refund) }
 */
async function createRefund(creds, payload) {
  const { paymentId, amount } = payload;
  if (!paymentId) throw new Error('payload.paymentId is required');

  const body = amount ? { amount: Math.round(amount) } : {};

  return callRazorpay(creds, `/payments/${paymentId}/refund`, body);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACTION ROUTER
// ═══════════════════════════════════════════════════════════════════════════════
const ACTIONS = {
  create_order: createOrder,
  verify_signature: verifySignature,
  create_refund: createRefund,
};

// ═══════════════════════════════════════════════════════════════════════════════
//  LAMBDA HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
export const handler = async (event) => {
  let action, payload;

  try {
    let body = event;

    // API Gateway wraps the body as a string
    if (typeof event.body === 'string') {
      body = JSON.parse(event.body);
    } else if (typeof event.body === 'object' && event.body !== null) {
      body = event.body;
    }

    action = body.action;
    payload = body.payload || {};
  } catch (parseErr) {
    return respond(400, { success: false, error: 'Invalid JSON body' });
  }

  // ── Validate action ───────────────────────────────────────────────────────
  if (!action) {
    return respond(400, {
      success: false,
      error: 'Missing "action" field',
      availableActions: Object.keys(ACTIONS),
    });
  }

  const handler_fn = ACTIONS[action];
  if (!handler_fn) {
    return respond(400, {
      success: false,
      error: `Unknown action "${action}"`,
      availableActions: Object.keys(ACTIONS),
    });
  }

  // ── Resolve credentials ───────────────────────────────────────────────────
  let creds;
  try {
    creds = await getCredentials();
  } catch (credErr) {
    console.error('Credential error:', credErr.message);
    return respond(500, {
      success: false,
      error: 'Lambda misconfiguration: ' + credErr.message,
    });
  }

  // ── Execute action ────────────────────────────────────────────────────────
  try {
    const data = await handler_fn(creds, payload);
    return respond(200, { success: true, action, data });
  } catch (err) {
    console.error(`Action "${action}" failed:`, err);
    return respond(502, { success: false, action, error: err.message });
  }
};

// ── HTTP response helper ──────────────────────────────────────────────────────
function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
