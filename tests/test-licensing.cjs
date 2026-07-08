'use strict';
const { createChecker } = require('./helpers/assert.cjs');

/**
 * Tests api/_lib/licensing.js — both halves of it:
 *   1. Pure logic (evaluateEntitlement, generateLicenseKey,
 *      currentUsagePeriod, normalizeEmail) — the most business-critical
 *      part of the whole licensing system, since a bug here could mean
 *      Free users getting unlimited Pro access, or Pro users getting
 *      incorrectly blocked.
 *   2. The thin KV-wrapper functions, exercised against a local-only
 *      @vercel/kv stub (see node_modules/@vercel/kv/index.js) rather than
 *      a live KV instance, which this sandbox has no access to. That stub
 *      is never committed — a real `npm install` on Vercel/locally
 *      installs the genuine package in its place.
 *
 * This file is written as an ES module consumer via dynamic import()
 * (not a plain require()), since api/_lib/licensing.js uses ES module
 * syntax (the whole api/ directory does, matching package.json's
 * "type": "module") — CommonJS require() cannot load that directly, but
 * dynamic import() works fine from a .cjs file regardless.
 */
module.exports = async function run(){
  const { check, getFailures } = createChecker();
  console.log('\n=== test-licensing.cjs ===');

  const licensing = await import('../api/_lib/licensing.js');
  const { __resetForTests } = await import('../api/_lib/kv-client.js');

  console.log('\n1) evaluateEntitlement: the core Free/Pro decision logic');
  {
    check('Free + MA + under limit -> allowed', licensing.evaluateEntitlement({ plan:'free', status:'active', protocol:'MA', usageCount:5 }).allowed === true);
    check('Free + MA + at limit (20) -> blocked, reason limit_reached', (() => {
      const r = licensing.evaluateEntitlement({ plan:'free', status:'active', protocol:'MA', usageCount:20 });
      return r.allowed === false && r.reason === 'limit_reached';
    })());
    check('Free + MA + one under limit (19) -> still allowed', licensing.evaluateEntitlement({ plan:'free', status:'active', protocol:'MA', usageCount:19 }).allowed === true);
    check('Free + non-MA protocol -> blocked, reason protocol_requires_pro', (() => {
      const r = licensing.evaluateEntitlement({ plan:'free', status:'active', protocol:'BEIDA', usageCount:0 });
      return r.allowed === false && r.reason === 'protocol_requires_pro';
    })());
    ['MS', 'OF', 'BLITZ', 'BEIDA'].forEach(protocol => {
      check('Free + ' + protocol + ' -> blocked (Free is MA-only)', licensing.evaluateEntitlement({ plan:'free', status:'active', protocol, usageCount:0 }).allowed === false);
    });

    check('Pro + any protocol -> always allowed regardless of usage', licensing.evaluateEntitlement({ plan:'pro', status:'active', protocol:'BEIDA', usageCount:999999 }).allowed === true);
    check('Pro + MA -> allowed too (Pro isn\'t restricted to non-MA)', licensing.evaluateEntitlement({ plan:'pro', status:'active', protocol:'MA', usageCount:999999 }).allowed === true);

    check('inactive status -> blocked regardless of plan (fails closed)', (() => {
      const r = licensing.evaluateEntitlement({ plan:'pro', status:'canceled', protocol:'MA', usageCount:0 });
      return r.allowed === false && r.reason === 'inactive';
    })());

    check('unrecognized plan value -> treated as Free (fails closed, not open)', (() => {
      const r = licensing.evaluateEntitlement({ plan:'something_unexpected', status:'active', protocol:'BEIDA', usageCount:0 });
      return r.allowed === false && r.reason === 'protocol_requires_pro';
    })());

    check('custom freeMonthlyLimit override respected', licensing.evaluateEntitlement({ plan:'free', status:'active', protocol:'MA', usageCount:5, freeMonthlyLimit: 5 }).allowed === false);
    check('custom freeProtocols override respected', licensing.evaluateEntitlement({ plan:'free', status:'active', protocol:'BEIDA', usageCount:0, freeProtocols: ['BEIDA'] }).allowed === true);

    check('every rejection includes a non-empty, teacher-facing message', (() => {
      const r = licensing.evaluateEntitlement({ plan:'free', status:'active', protocol:'BEIDA', usageCount:0 });
      return typeof r.message === 'string' && r.message.length > 10;
    })());
  }

  console.log('\n2) generateLicenseKey: format and uniqueness');
  {
    const key1 = licensing.generateLicenseKey();
    const key2 = licensing.generateLicenseKey();
    check('starts with the expected prefix', key1.startsWith('kb_live_'));
    check('is reasonably long (not a trivially guessable short string)', key1.length > 30);
    check('two calls produce different keys', key1 !== key2);
  }

  console.log('\n3) currentUsagePeriod: stable, UTC-based YYYY-MM format');
  {
    check('formats as YYYY-MM', /^\d{4}-\d{2}$/.test(licensing.currentUsagePeriod(new Date('2026-07-15T12:00:00Z'))));
    check('correct month for a real date', licensing.currentUsagePeriod(new Date('2026-07-15T12:00:00Z')) === '2026-07');
    check('different months produce different periods', licensing.currentUsagePeriod(new Date('2026-07-01T00:00:00Z')) !== licensing.currentUsagePeriod(new Date('2026-08-01T00:00:00Z')));
  }

  console.log('\n4) normalizeEmail: case/whitespace insensitive');
  {
    check('lowercases', licensing.normalizeEmail('Nina@Example.COM') === 'nina@example.com');
    check('trims whitespace', licensing.normalizeEmail('  nina@example.com  ') === 'nina@example.com');
    check('empty/undefined -> empty string, not a crash', licensing.normalizeEmail(undefined) === '' && licensing.normalizeEmail('') === '');
  }

  console.log('\n5) KV-backed primitives (against the local test stub)');
  {
    __resetForTests();

    const key = licensing.generateLicenseKey();
    check('getLicense on a never-created key -> null, not a crash', (await licensing.getLicense(key)) === null);

    await licensing.saveLicense(key, { email:'a@b.com', plan:'free', status:'active', paymentCustomerId:null, paymentSubscriptionId:null, createdAt:'2026-01-01' });
    const fetched = await licensing.getLicense(key);
    check('saveLicense then getLicense round-trips correctly', fetched && fetched.plan === 'free' && fetched.email === 'a@b.com');

    await licensing.saveEmailIndex('a@b.com', key);
    check('email index resolves back to the same key', (await licensing.getLicenseKeyByEmail('a@b.com')) === key);
    check('email index lookup is case/whitespace-normalized', (await licensing.getLicenseKeyByEmail(' A@B.com ')) === key);

    await licensing.savePaymentCustomerIndex('cust_1', key);
    check('payment-customer index resolves back to the same key', (await licensing.getLicenseKeyByPaymentCustomerId('cust_1')) === key);

    const period = licensing.currentUsagePeriod();
    check('usage count starts at 0 for a fresh key/period', (await licensing.getUsageCount(key, period)) === 0);
    await licensing.incrementUsage(key, period);
    await licensing.incrementUsage(key, period);
    check('usage count increments correctly across multiple calls', (await licensing.getUsageCount(key, period)) === 2);

    const otherPeriod = '2020-01'; // a different period entirely
    check('usage counts are isolated per period, not shared globally', (await licensing.getUsageCount(key, otherPeriod)) === 0);
  }

  console.log('\n6) Webhook dedup primitives: hasProcessedWebhook / markWebhookProcessed');
  {
    __resetForTests();
    const hash1 = 'abc123fakehash';
    const hash2 = 'def456differenthash';

    check('an unseen hash reports as not processed', (await licensing.hasProcessedWebhook(hash1)) === false);
    await licensing.markWebhookProcessed(hash1);
    check('after marking, the SAME hash reports as processed', (await licensing.hasProcessedWebhook(hash1)) === true);
    check('a DIFFERENT hash is unaffected — dedup is per-body, not global', (await licensing.hasProcessedWebhook(hash2)) === false);
  }

  return getFailures();
};

if(require.main === module){
  module.exports().then(failures => {
    console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });
}
