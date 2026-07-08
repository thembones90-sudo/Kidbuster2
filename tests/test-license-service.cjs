'use strict';
const { createChecker } = require('./helpers/assert.cjs');

/**
 * Tests api/_lib/license-service.js — the orchestration layer sitting
 * between any payment provider adapter and the rest of the app:
 *
 *   Payment Provider  →  License Service  →  Kidbuster
 *
 * This is deliberately tested independent of any payment provider —
 * these functions take plain values (email, licenseKey, a generic
 * paymentCustomerId/paymentSubscriptionId pair) and never reference
 * Lemon Squeezy, Paddle, or Stripe at all. See test-payment-provider.cjs
 * for the provider-adapter-specific tests.
 */
module.exports = async function run(){
  const { check, getFailures } = createChecker();
  console.log('\n=== test-license-service.cjs ===');

  const svc = await import('../api/_lib/license-service.js');
  const licensing = await import('../api/_lib/licensing.js');
  const { __resetForTests } = await import('../api/_lib/kv-client.js');

  console.log('\n1) getOrCreateFreeLicense: idempotent, email-normalized');
  {
    __resetForTests();
    const key1 = await svc.getOrCreateFreeLicense('teacher@example.com');
    const key2 = await svc.getOrCreateFreeLicense('Teacher@Example.com'); // different case
    const key3 = await svc.getOrCreateFreeLicense('  teacher@example.com  '); // whitespace
    check('same email (any case/whitespace) -> same license key every time', key1 === key2 && key2 === key3);

    const license = await licensing.getLicense(key1);
    check('new license starts on the Free plan, active', license.plan === 'free' && license.status === 'active');
    check('new license has no payment identifiers yet', license.paymentCustomerId === null && license.paymentSubscriptionId === null);

    const differentKey = await svc.getOrCreateFreeLicense('someone-else@example.com');
    check('a genuinely different email gets a genuinely different key', differentKey !== key1);
  }

  console.log('\n2) activateOrRenewPro: upgrades an existing license by key');
  {
    __resetForTests();
    const key = await svc.getOrCreateFreeLicense('nina@example.com');
    await svc.activateOrRenewPro({ licenseKey: key, paymentCustomerId: 'cust_1', paymentSubscriptionId: 'sub_1' });

    const license = await licensing.getLicense(key);
    check('plan upgraded to pro', license.plan === 'pro');
    check('status is active', license.status === 'active');
    check('payment identifiers stored', license.paymentCustomerId === 'cust_1' && license.paymentSubscriptionId === 'sub_1');
    check('email preserved from before the upgrade', license.email === 'nina@example.com');

    const foundByCustomerId = await licensing.getLicenseKeyByPaymentCustomerId('cust_1');
    check('payment-customer index was created, resolving back to this license', foundByCustomerId === key);
  }

  console.log('\n3) activateOrRenewPro: falls back to email lookup when no licenseKey is given');
  {
    __resetForTests();
    const key = await svc.getOrCreateFreeLicense('layne@example.com');
    await svc.activateOrRenewPro({ email: 'layne@example.com', paymentCustomerId: 'cust_2', paymentSubscriptionId: 'sub_2' }); // no licenseKey passed

    const license = await licensing.getLicense(key);
    check('the SAME existing license (found via email) was upgraded, not a new one created', license.plan === 'pro' && license.paymentCustomerId === 'cust_2');
  }

  console.log('\n4) activateOrRenewPro: creates a fresh license if genuinely neither key nor email resolves to one (never drops a real payment)');
  {
    __resetForTests();
    const newKey = await svc.activateOrRenewPro({ email: 'brand-new@example.com', paymentCustomerId: 'cust_3', paymentSubscriptionId: 'sub_3' });
    check('returns a usable license key even with no prior signup', typeof newKey === 'string' && newKey.startsWith('kb_live_'));
    const license = await licensing.getLicense(newKey);
    check('that new license is Pro from the start', license.plan === 'pro' && license.email === 'brand-new@example.com');
  }

  console.log('\n5) downgradeToFree: by license key directly');
  {
    __resetForTests();
    const key = await svc.getOrCreateFreeLicense('maxine@example.com');
    await svc.activateOrRenewPro({ licenseKey: key, paymentCustomerId: 'cust_4', paymentSubscriptionId: 'sub_4' });
    await svc.downgradeToFree({ licenseKey: key });

    const license = await licensing.getLicense(key);
    check('plan reverted to free', license.plan === 'free');
    check('subscription id cleared (no longer subscribed to anything)', license.paymentSubscriptionId === null);
    check('license status stays active — a lapsed Pro subscription keeps Free access, not a full lockout', license.status === 'active');
  }

  console.log('\n6) downgradeToFree: by payment customer id (the real webhook path — no licenseKey in a subscription.updated/deleted event)');
  {
    __resetForTests();
    const key = await svc.getOrCreateFreeLicense('kara@example.com');
    await svc.activateOrRenewPro({ licenseKey: key, paymentCustomerId: 'cust_5', paymentSubscriptionId: 'sub_5' });
    await svc.downgradeToFree({ paymentCustomerId: 'cust_5' }); // no licenseKey — must resolve via the index

    const license = await licensing.getLicense(key);
    check('correctly found and downgraded the right license via the payment-customer index', license.plan === 'free');
  }

  console.log('\n7) downgradeToFree: unknown customer id -> no-op, does not crash');
  {
    __resetForTests();
    const result = await svc.downgradeToFree({ paymentCustomerId: 'never-seen-before' });
    check('returns null rather than throwing for an unresolvable customer id', result === null);
  }

  console.log('\n8) checkEntitlement: the full lifecycle a real license actually goes through');
  {
    __resetForTests();
    const key = await svc.getOrCreateFreeLicense('boyan@example.com');

    const free1 = await svc.checkEntitlement(key, 'MA');
    check('fresh Free license, MA -> allowed', free1.allowed === true);

    const free2 = await svc.checkEntitlement(key, 'BEIDA');
    check('fresh Free license, Beida -> blocked (Pro-only protocol)', free2.allowed === false && free2.reason === 'protocol_requires_pro');

    await svc.activateOrRenewPro({ licenseKey: key, paymentCustomerId: 'cust_6', paymentSubscriptionId: 'sub_6' });
    const pro1 = await svc.checkEntitlement(key, 'BEIDA');
    check('after upgrading, same key can now use Beida', pro1.allowed === true);

    await svc.downgradeToFree({ paymentCustomerId: 'cust_6' });
    const free3 = await svc.checkEntitlement(key, 'BEIDA');
    check('after downgrading, same key is blocked from Beida again', free3.allowed === false);

    const invalid = await svc.checkEntitlement('kb_live_totally_made_up', 'MA');
    check('a nonexistent license key -> invalid_key, not a crash', invalid.allowed === false && invalid.reason === 'invalid_key');
  }

  console.log('\n9) recordUsage: actually increments what checkEntitlement reads');
  {
    __resetForTests();
    const key = await svc.getOrCreateFreeLicense('faye@example.com');
    for(let i = 0; i < 19; i++){
      await svc.recordUsage(key);
    }
    const stillOk = await svc.checkEntitlement(key, 'MA');
    check('19 recorded generations -> still allowed (under the 20 limit)', stillOk.allowed === true);

    await svc.recordUsage(key); // 20th
    const nowBlocked = await svc.checkEntitlement(key, 'MA');
    check('20th recorded generation -> now blocked (limit reached)', nowBlocked.allowed === false && nowBlocked.reason === 'limit_reached');
  }

  console.log('\n10) Founder/owner keys: private full-access keys bypass payment forever and do not consume usage');
  {
    __resetForTests();
    const oldOwnerKeys = process.env.OWNER_LICENSE_KEYS;
    const oldFounderKeys = process.env.FOUNDER_LICENSE_KEYS;
    process.env.OWNER_LICENSE_KEYS = 'test_owner_key';
    process.env.FOUNDER_LICENSE_KEYS = 'test_founder_key';

    const ownerOf = await svc.checkEntitlement('test_owner_key', 'OF');
    check('owner key can use any Pro protocol without a payment record', ownerOf.allowed === true && ownerOf.license.plan === 'pro' && ownerOf.license.founder === true);

    const founderBeida = await svc.checkEntitlement('test_founder_key', 'BEIDA');
    check('founder key can use Pro-only protocols', founderBeida.allowed === true && founderBeida.license.plan === 'pro' && founderBeida.license.founder === true);

    for(let i = 0; i < 50; i++){
      await svc.recordUsage('test_owner_key');
      await svc.recordUsage('test_founder_key');
    }
    check('owner usage is never tracked against monthly limits', (await licensing.getUsageCount('test_owner_key')) === 0);
    check('founder usage is never tracked against monthly limits', (await licensing.getUsageCount('test_founder_key')) === 0);

    const invalid = await svc.checkEntitlement('test_non_founder_key', 'BEIDA');
    check('nearby non-founder password is still rejected', invalid.allowed === false && invalid.reason === 'invalid_key');

    if(oldOwnerKeys === undefined) delete process.env.OWNER_LICENSE_KEYS;
    else process.env.OWNER_LICENSE_KEYS = oldOwnerKeys;
    if(oldFounderKeys === undefined) delete process.env.FOUNDER_LICENSE_KEYS;
    else process.env.FOUNDER_LICENSE_KEYS = oldFounderKeys;
  }

  return getFailures();
};

if(require.main === module){
  module.exports().then(failures => {
    console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });
}
