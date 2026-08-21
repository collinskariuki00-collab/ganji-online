// Safaricom Daraja STK Push — same pattern as the M-Pesa POS project.
// Sandbox base: https://sandbox.safaricom.co.ke, Prod: https://api.safaricom.co.ke
const axios = require('axios');

const BASE = (process.env.MPESA_ENV === 'production')
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

async function getAccessToken() {
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  try {
    const { data } = await axios.get(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    return data.access_token;
  } catch (err) {
    // Safaricom returns a plain 400/401 with almost no body if the
    // consumer key/secret pair is wrong — surface that clearly instead of
    // a bare "Request failed with status code 400".
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`M-Pesa auth failed (check MPESA_CONSUMER_KEY/SECRET): ${detail}`);
  }
}

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// amount in KES, phone in 2547XXXXXXXX format
async function stkPush({ phone, amount, accountRef, description, callbackUrl }) {
  const token = await getAccessToken();
  const ts = timestamp();
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey   = process.env.MPESA_PASSKEY;
  const password  = Buffer.from(`${shortcode}${passkey}${ts}`).toString('base64');

  try {
    const { data } = await axios.post(`${BASE}/mpesa/stkpush/v1/processrequest`, {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: accountRef,
      TransactionDesc: description,
    }, { headers: { Authorization: `Bearer ${token}` } });

    return data; // { MerchantRequestID, CheckoutRequestID, ResponseCode, ... }
  } catch (err) {
    // Common causes at this step: CallBackURL isn't a public https:// URL
    // (Safaricom rejects http:// or localhost outright), wrong shortcode/
    // passkey pair, or a malformed phone number. Surface Safaricom's own
    // error message so it's obvious which one.
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`STK push failed: ${detail}`);
  }
}

module.exports = { stkPush };
