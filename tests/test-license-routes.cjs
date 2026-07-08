'use strict';
const { createChecker } = require('./helpers/assert.cjs');

module.exports = async function run(){
  const { check, getFailures } = createChecker();
  console.log('\n=== test-license-routes.cjs ===');

  process.env.KIDBUSTER_TEST_KV = '1';

  const svc = await import('../api/_lib/license-service.js');
  const licensing = await import('../api/_lib/licensing.js');
  const { __resetForTests } = await import('../api/_lib/kv-client.js');
  const statusHandler = await import('../api/license-status.js');
  const recoverHandler = await import('../api/license-recover.js');

  async function send(handler, { method = 'POST', headers = {}, body = {} } = {}){
    const req = { method, headers, body };
    let statusCode = null;
    let jsonBody = null;
    const res = {
      status(code){ statusCode = code; return res; },
      json(bodyJson){ jsonBody = bodyJson; return res; }
    };
    await handler.default(req, res);
    return { statusCode, jsonBody };
  }

  console.log('\n1) license-recover: finds an existing key by normalized email');
  {
    __resetForTests();
    const key = await svc.getOrCreateFreeLicense('recover@example.com');
    const result = await send(recoverHandler, { body: { email: ' Recover@Example.com ' } });
    check('recover returns 200 for a known email', result.statusCode === 200);
    check('recover returns the same existing license key', result.jsonBody.licenseKey === key);
  }

  console.log('\n2) license-recover: validates bad or unknown email');
  {
    __resetForTests();
    const bad = await send(recoverHandler, { body: { email: 'not-an-email' } });
    check('invalid email returns 400', bad.statusCode === 400);

    const missing = await send(recoverHandler, { body: { email: 'missing@example.com' } });
    check('unknown email returns 404', missing.statusCode === 404);
  }

  console.log('\n3) license-status: reports Free usage and remaining monthly allowance');
  {
    __resetForTests();
    const key = await svc.getOrCreateFreeLicense('status@example.com');
    await svc.recordUsage(key);
    await svc.recordUsage(key);

    const result = await send(statusHandler, { method: 'GET', headers: { 'x-app-key': key } });
    check('status returns 200 for a real license', result.statusCode === 200);
    check('status reports Free plan and active state', result.jsonBody.plan === 'free' && result.jsonBody.status === 'active');
    check('status includes usage and remaining free reports', result.jsonBody.usageCount === 2 && result.jsonBody.remainingFreeReports === licensing.FREE_MONTHLY_LIMIT - 2);
  }

  console.log('\n4) license-status: owner key is Pro forever and usage-free');
  {
    __resetForTests();
    const oldOwnerKeys = process.env.OWNER_LICENSE_KEYS;
    process.env.OWNER_LICENSE_KEYS = 'test_owner_key';

    const result = await send(statusHandler, { method: 'GET', headers: { 'x-app-key': 'test_owner_key' } });
    check('owner key status returns 200', result.statusCode === 200);
    check('owner key reports Pro founder access', result.jsonBody.plan === 'pro' && result.jsonBody.founder === true);
    check('owner key has no Free remaining limit', result.jsonBody.remainingFreeReports === null);

    if(oldOwnerKeys === undefined) delete process.env.OWNER_LICENSE_KEYS;
    else process.env.OWNER_LICENSE_KEYS = oldOwnerKeys;
  }

  console.log('\n5) license-status: missing or invalid key is rejected');
  {
    __resetForTests();
    const missing = await send(statusHandler, { method: 'GET' });
    check('missing key returns 401', missing.statusCode === 401);

    const invalid = await send(statusHandler, { method: 'GET', headers: { 'x-app-key': 'nope' } });
    check('invalid key returns 401', invalid.statusCode === 401);
  }

  return getFailures();
};

if(require.main === module){
  module.exports().then(failures => {
    console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });
}
