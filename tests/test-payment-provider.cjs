'use strict';
const crypto = require('crypto');
const { createChecker } = require('./helpers/assert.cjs');

/**
 * Tests the payment provider abstraction layer:
 *   - api/_lib/providers/index.js (the registry/swap-point)
 *   - api/_lib/providers/lemonsqueezy.js (the one real, working adapter)
 *   - api/_lib/providers/paddle.js (the documented stub)
 *
 * The Lemon Squeezy tests use constructed payloads matching Lemon
 * Squeezy's real, documented webhook shape (verified against
 * docs.lemonsqueezy.com directly while building this, not assumed) rather
 * than needing a live Lemon Squeezy account or network access.
 */
module.exports = async function run(){
  const { check, getFailures } = createChecker();
  console.log('\n=== test-payment-provider.cjs ===');

  const registry = await import('../api/_lib/providers/index.js');
  const lemonsqueezy = await import('../api/_lib/providers/lemonsqueezy.js');
  const paddle = await import('../api/_lib/providers/paddle.js');

  console.log('\n1) Provider registry: selects the active adapter via PAYMENT_PROVIDER');
  {
    const originalEnv = process.env.PAYMENT_PROVIDER;

    delete process.env.PAYMENT_PROVIDER;
    check('defaults to lemonsqueezy when PAYMENT_PROVIDER is unset', registry.getActiveProvider() === lemonsqueezy);

    process.env.PAYMENT_PROVIDER = 'lemonsqueezy';
    check('explicit "lemonsqueezy" resolves to the lemonsqueezy adapter', registry.getActiveProvider() === lemonsqueezy);

    process.env.PAYMENT_PROVIDER = 'paddle';
    check('explicit "paddle" resolves to the paddle adapter', registry.getActiveProvider() === paddle);

    process.env.PAYMENT_PROVIDER = 'PayPal'; // not a real provider name in this project
    check('an unknown provider name throws a clear error rather than silently picking one', (() => {
      try{ registry.getActiveProvider(); return false; }
      catch(e){ return e.message.includes('Unknown PAYMENT_PROVIDER'); }
    })());

    if(originalEnv === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = originalEnv;
  }

  console.log('\n2) Paddle stub: both interface functions exist and clearly explain they are not implemented yet');
  {
    check('createCheckoutUrl exists as a function', typeof paddle.createCheckoutUrl === 'function');
    check('verifyAndNormalizeWebhook exists as a function', typeof paddle.verifyAndNormalizeWebhook === 'function');

    let threwCreate = false, createMessage = '';
    try{ await paddle.createCheckoutUrl({ email:'a@b.com', licenseKey:'kb_live_x' }); }
    catch(e){ threwCreate = true; createMessage = e.message; }
    check('createCheckoutUrl throws (not implemented), with a clear, actionable message', threwCreate && createMessage.includes('not implemented yet'));

    let threwVerify = false;
    try{ await paddle.verifyAndNormalizeWebhook({ rawBody: Buffer.from('{}'), headers: {} }); }
    catch(e){ threwVerify = true; }
    check('verifyAndNormalizeWebhook throws (not implemented) too, rather than silently accepting anything', threwVerify);
  }

  console.log('\n3) Lemon Squeezy: webhook signature verification');
  {
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'test_secret_for_ci';

    const payload = {
      meta: { event_name: 'subscription_created', custom_data: { license_key: 'kb_live_test_key' } },
      data: { type: 'subscriptions', id: '555', attributes: { customer_id: 42, user_email: 'teacher@example.com', status: 'active' } }
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const validSignature = crypto.createHmac('sha256', 'test_secret_for_ci').update(rawBody).digest('hex');

    const result = await lemonsqueezy.verifyAndNormalizeWebhook({ rawBody, headers: { 'x-signature': validSignature } });
    check('valid signature -> verifies successfully, no error thrown', !!result);
    check('correctly normalizes subscription_created -> payment_succeeded', result.type === 'payment_succeeded');
    check('license key threaded through from custom_data', result.licenseKey === 'kb_live_test_key');
    check('email extracted from data.attributes.user_email', result.email === 'teacher@example.com');
    check('customer id extracted and stringified', result.paymentCustomerId === '42');
    check('subscription id (data.id) extracted and stringified', result.paymentSubscriptionId === '555');

    let threwBadSig = false;
    try{ await lemonsqueezy.verifyAndNormalizeWebhook({ rawBody, headers: { 'x-signature': 'not-the-real-signature' } }); }
    catch(e){ threwBadSig = true; }
    check('tampered/wrong signature -> throws rather than trusting the payload', threwBadSig);

    let threwNoSig = false;
    try{ await lemonsqueezy.verifyAndNormalizeWebhook({ rawBody, headers: {} }); }
    catch(e){ threwNoSig = true; }
    check('missing signature header entirely -> throws', threwNoSig);

    let threwTamperedBody = false;
    try{
      const tamperedBody = Buffer.from(JSON.stringify({ ...payload, data: { ...payload.data, attributes: { ...payload.data.attributes, customer_id: 999 } } }));
      await lemonsqueezy.verifyAndNormalizeWebhook({ rawBody: tamperedBody, headers: { 'x-signature': validSignature } }); // signature computed for the ORIGINAL body
    }catch(e){ threwTamperedBody = true; }
    check('body tampered after signing (signature no longer matches) -> throws', threwTamperedBody);
  }

  console.log('\n4) Lemon Squeezy: all four required event types normalize to the correct internal type');
  {
    const secret = 'test_secret_for_ci';
    const eventMap = {
      subscription_created: 'payment_succeeded',
      subscription_payment_success: 'subscription_renewed',
      subscription_cancelled: 'subscription_cancelled',
      subscription_expired: 'subscription_expired'
    };
    for(const [lsEventName, expectedType] of Object.entries(eventMap)){
      const payload = {
        meta: { event_name: lsEventName, custom_data: { license_key: 'kb_live_abc' } },
        data: { id: '1', attributes: { customer_id: 1, user_email: 'x@y.com', status: 'active' } }
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const result = await lemonsqueezy.verifyAndNormalizeWebhook({ rawBody, headers: { 'x-signature': signature } });
      check(lsEventName + ' -> normalized to "' + expectedType + '"', result.type === expectedType);
    }
  }

  console.log('\n5) Lemon Squeezy: an irrelevant (but validly-signed) event type is not an error, just type: null');
  {
    const secret = 'test_secret_for_ci';
    const payload = { meta: { event_name: 'order_created', custom_data: {} }, data: { id: '1', attributes: {} } };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const result = await lemonsqueezy.verifyAndNormalizeWebhook({ rawBody, headers: { 'x-signature': signature } });
    check('order_created (not one of the 4 handled types) -> type: null, no exception', result.type === null);
  }

  console.log('\n6) Lemon Squeezy: missing webhook secret configuration throws clearly rather than silently accepting anything');
  {
    delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    let threw = false, message = '';
    try{ await lemonsqueezy.verifyAndNormalizeWebhook({ rawBody: Buffer.from('{}'), headers: { 'x-signature': 'anything' } }); }
    catch(e){ threw = true; message = e.message; }
    check('no LEMONSQUEEZY_WEBHOOK_SECRET set -> throws a clear config error', threw && message.includes('LEMONSQUEEZY_WEBHOOK_SECRET'));
  }

  console.log('\n7) Lemon Squeezy: createCheckoutUrl fails clearly when required config is missing');
  {
    delete process.env.LEMONSQUEEZY_API_KEY;
    delete process.env.LEMONSQUEEZY_STORE_ID;
    delete process.env.LEMONSQUEEZY_PRO_VARIANT_ID;
    let threw = false, message = '';
    try{ await lemonsqueezy.createCheckoutUrl({ email: 'a@b.com', licenseKey: 'kb_live_x' }); }
    catch(e){ threw = true; message = e.message; }
    check('missing LS API config -> throws a clear config error rather than a confusing network failure', threw && message.includes('LEMONSQUEEZY_'));
  }

  return getFailures();
};

if(require.main === module){
  module.exports().then(failures => {
    console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });
}
