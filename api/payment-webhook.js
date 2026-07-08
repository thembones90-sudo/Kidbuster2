// Receives payment lifecycle webhooks from whichever payment provider is
// currently active (see api/_lib/providers/index.js) and translates them
// into calls to license-service.js. This route has zero knowledge of any
// specific provider's API shape, signature scheme, or event names — that
// all lives in api/_lib/providers/<name>.js. Swapping providers means
// pointing PAYMENT_PROVIDER at a different, fully-implemented adapter;
// this file never changes.
//
// Vercel's Node.js functions parse the request body as JSON by default,
// which would corrupt the raw bytes a provider's signature was computed
// over — signature verification needs the exact original bytes, not a
// re-serialized copy. `export const config = { api: { bodyParser: false } }`
// disables that default parsing for this route specifically, so the raw
// body can be read directly off the request stream instead.

import crypto from 'crypto';
import { getActiveProvider } from './_lib/providers/index.js';
import { activateOrRenewPro, downgradeToFree } from './_lib/license-service.js';
import { hasProcessedWebhook, markWebhookProcessed } from './_lib/licensing.js';

export const config = {
  api: { bodyParser: false }
};

function readRawBody(req){
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await readRawBody(req);
  const provider = getActiveProvider();

  let event;
  try{
    event = await provider.verifyAndNormalizeWebhook({ rawBody, headers: req.headers });
  }catch(err){
    console.error('payment-webhook: verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid webhook request' });
  }

  // --- duplicate / replay protection ---
  // A validly-signed body that's byte-for-byte identical to one already
  // processed is either a legitimate retry (Lemon Squeezy resends up to
  // 3 times if a webhook doesn't respond 200) or a replay of a captured
  // request — both are indistinguishable from the signature alone, and
  // both are handled the same way: skip re-processing, acknowledge with
  // 200 so the provider doesn't keep retrying something already applied.
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  let alreadyProcessed = false;
  try{
    alreadyProcessed = await hasProcessedWebhook(bodyHash);
  }catch(err){
    // If the dedup check itself can't be reached (KV unavailable), fail
    // OPEN on the dedup check specifically rather than blocking a
    // genuinely new, real payment update from ever being applied — the
    // license operations below (activateOrRenewPro/downgradeToFree) are
    // themselves idempotent upserts, so processing something twice due to
    // a dedup-check outage is a much smaller risk than never processing
    // a real payment at all.
    console.error('payment-webhook: dedup check failed, proceeding anyway:', err);
  }
  if(alreadyProcessed){
    return res.status(200).json({ received: true, duplicate: true });
  }

  try{
    switch(event.type){
      case 'payment_succeeded':
      case 'subscription_renewed':
        await activateOrRenewPro({
          licenseKey: event.licenseKey,
          email: event.email,
          paymentCustomerId: event.paymentCustomerId,
          paymentSubscriptionId: event.paymentSubscriptionId
        });
        break;

      case 'subscription_cancelled':
      case 'subscription_expired':
        await downgradeToFree({
          licenseKey: event.licenseKey,
          paymentCustomerId: event.paymentCustomerId
        });
        break;

      default:
        // A validly-signed event this app doesn't act on (e.g. a plain
        // order_created with no subscription attached) — not an error,
        // just nothing to do.
        break;
    }

    try{
      await markWebhookProcessed(bodyHash);
    }catch(err){
      // Marking-as-processed failing doesn't undo the license update that
      // already succeeded above — worst case, a future retry of this
      // exact same event re-applies the same (idempotent) update again.
      console.error('payment-webhook: failed to record dedup marker (event still applied):', err);
    }

    return res.status(200).json({ received: true });
  }catch(err){
    console.error('payment-webhook: error processing event ' + event.type + ':', err);
    // A non-200 here tells the provider to retry the event later instead
    // of considering it delivered — important, since this branch means a
    // real payment update didn't get applied. Deliberately NOT marked as
    // processed, so the retry actually gets a chance to succeed.
    return res.status(500).json({ error: 'Error processing webhook event' });
  }
}
