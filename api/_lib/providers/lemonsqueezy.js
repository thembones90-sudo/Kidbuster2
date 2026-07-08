// Lemon Squeezy payment provider adapter. Implements the two-function
// interface every provider adapter must implement (see the contract
// documented in api/_lib/providers/index.js) — this is the ONLY file in
// this project that knows anything about Lemon Squeezy's specific API
// shapes, webhook event names, or signature scheme. Swapping to a
// different provider later never touches anything outside this folder.
//
// Verified directly against Lemon Squeezy's own documentation
// (docs.lemonsqueezy.com), not assumed from memory:
// - Webhooks are signed via HMAC-SHA256 of the raw request body, sent in
//   the X-Signature header as a hex digest — verified with a timing-safe
//   comparison, never a plain === comparison (a naive === would leak
//   timing information an attacker could exploit to forge a valid
//   signature byte-by-byte).
// - The event name arrives in the JSON body's meta.event_name field —
//   read from there rather than the X-Event-Name header, since only the
//   body itself is covered by the signature.
// - Any custom_data passed at checkout creation (via checkout_data.custom)
//   is echoed back in meta.custom_data on every subsequent webhook for
//   that same subscription — this is how the original license key
//   survives across the entire subscription lifecycle (created, renewed,
//   canceled, expired), not just the very first webhook.

import crypto from 'crypto';

const EVENT_TYPE_MAP = {
  subscription_created: 'payment_succeeded',
  subscription_payment_success: 'subscription_renewed',
  subscription_cancelled: 'subscription_cancelled',
  subscription_expired: 'subscription_expired'
  // Anything else (subscription_updated, subscription_paused,
  // subscription_payment_failed, order_created, etc.) is outside the
  // four notifications this app's licensing actually needs to react to
  // — see the interface contract in api/_lib/providers/index.js.
};

/**
 * Creates a Lemon Squeezy Checkout for the Pro subscription and returns
 * the URL to redirect the browser to. The license key is threaded
 * through as custom checkout data specifically so every later webhook
 * for this subscription (renewal, cancellation, expiration) can be
 * traced back to the same license record without needing a customer-id
 * lookup as the only path.
 * @param {{email: string, licenseKey: string}} params
 * @returns {Promise<string>} checkout URL
 */
export async function createCheckoutUrl({ email, licenseKey }){
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const variantId = process.env.LEMONSQUEEZY_PRO_VARIANT_ID;
  if(!apiKey || !storeId || !variantId){
    throw new Error('Missing LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID, or LEMONSQUEEZY_PRO_VARIANT_ID');
  }

  const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email,
            custom: { license_key: licenseKey }
          }
        },
        relationships: {
          store: { data: { type: 'stores', id: String(storeId) } },
          variant: { data: { type: 'variants', id: String(variantId) } }
        }
      }
    })
  });

  if(!response.ok){
    const errBody = await response.text();
    throw new Error('Lemon Squeezy checkout creation failed (' + response.status + '): ' + errBody);
  }

  const data = await response.json();
  const url = data && data.data && data.data.attributes && data.data.attributes.url;
  if(!url) throw new Error('Lemon Squeezy checkout response did not include a URL');
  return url;
}

/**
 * Verifies a webhook's signature and normalizes it into this app's
 * provider-agnostic event shape. Throws only for a genuinely invalid or
 * unverifiable request (bad/missing signature, unconfigured secret,
 * unparseable body) — the route handler turns that into a 400. A
 * validly-signed event of a type this app doesn't act on (e.g.
 * order_created) is NOT an error: it returns normally with type: null,
 * and the route handler just acknowledges it with 200 and does nothing.
 * @param {{rawBody: Buffer, headers: object}} params
 * @returns {Promise<{type: string|null, licenseKey: string|null, email: string|null, paymentCustomerId: string|null, paymentSubscriptionId: string|null}>}
 */
export async function verifyAndNormalizeWebhook({ rawBody, headers }){
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if(!secret){
    throw new Error('LEMONSQUEEZY_WEBHOOK_SECRET is not set');
  }

  const signature = headers['x-signature'];
  if(!signature){
    throw new Error('Missing X-Signature header');
  }

  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const signatureBuffer = Buffer.from(signature, 'utf8');
  const digestBuffer = Buffer.from(digest, 'utf8');
  const isValid = signatureBuffer.length === digestBuffer.length
    && crypto.timingSafeEqual(signatureBuffer, digestBuffer);
  if(!isValid){
    throw new Error('Invalid webhook signature');
  }

  let payload;
  try{
    payload = JSON.parse(rawBody.toString('utf8'));
  }catch(e){
    throw new Error('Webhook body was not valid JSON');
  }

  const eventName = payload && payload.meta && payload.meta.event_name;
  const type = EVENT_TYPE_MAP[eventName] || null;
  const customData = (payload && payload.meta && payload.meta.custom_data) || {};
  const attributes = (payload && payload.data && payload.data.attributes) || {};
  const dataId = payload && payload.data && payload.data.id;

  return {
    type,
    licenseKey: customData.license_key || null,
    email: attributes.user_email || null,
    paymentCustomerId: attributes.customer_id != null ? String(attributes.customer_id) : null,
    // data.id is the subscription's own id for every subscription_*
    // event this adapter maps — correct for all four handled types.
    paymentSubscriptionId: dataId != null ? String(dataId) : null
  };
}
