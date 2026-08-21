const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://api.paystack.co';

function isConfigured() {
  return Boolean(process.env.PAYSTACK_SECRET_KEY);
}

function client() {
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
}

// amountKes is a plain KES value (e.g. 3250) — Paystack wants every
// currency's amount in its smallest subunit, so this multiplies by 100
// regardless of currency (their docs are explicit that this applies even
// to currencies without a "real" subunit).
async function initializeTransaction({ email, amountKes, reference, callbackUrl, metadata }) {
  const { data } = await client().post('/transaction/initialize', {
    email,
    amount: Math.round(amountKes * 100),
    currency: 'KES',
    reference,
    callback_url: callbackUrl,
    metadata,
  });
  return data.data; // { authorization_url, access_code, reference }
}

async function verifyTransaction(reference) {
  const { data } = await client().get(`/transaction/verify/${encodeURIComponent(reference)}`);
  return data.data; // { status, reference, amount, customer, metadata, ... }
}

// Paystack signs webhook bodies with HMAC-SHA512 of the raw request body
// using the secret key — rawBody must be the exact bytes as received
// (see server.js's express.raw() registration for this route), not a
// re-serialized JSON object, or the signature will never match.
function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
    .update(rawBody)
    .digest('hex');
  return hash === signatureHeader;
}

module.exports = { isConfigured, initializeTransaction, verifyTransaction, verifySignature };
