'use strict';
const { createChecker } = require('./helpers/assert.cjs');

module.exports = async function run(){
  const { check, getFailures } = createChecker();
  console.log('\n=== test-feedback.cjs ===');

  process.env.KIDBUSTER_TEST_KV = '1';

  const feedback = await import('../api/feedback.js');
  const svc = await import('../api/_lib/license-service.js');
  const { __resetForTests } = await import('../api/_lib/kv-client.js');

  const originalEnv = {
    APP_ACCESS_KEY: process.env.APP_ACCESS_KEY,
    OWNER_LICENSE_KEYS: process.env.OWNER_LICENSE_KEYS,
    FOUNDER_LICENSE_KEYS: process.env.FOUNDER_LICENSE_KEYS,
    GOOGLE_SHEET_WEBHOOK_URL: process.env.GOOGLE_SHEET_WEBHOOK_URL
  };
  const originalFetch = global.fetch;

  function restoreEnv(){
    for(const [key, value] of Object.entries(originalEnv)){
      if(value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  async function callFeedback({ key, body }){
    const req = {
      method: 'POST',
      headers: key ? { 'x-app-key': key } : {},
      body: body || {
        teacherName: 'Teacher Devin',
        protocol: 'MA',
        ratingTier: 'standard',
        score: 5,
        comment: 'Great one'
      }
    };
    let statusCode = null;
    let jsonBody = null;
    const res = {
      status(code){
        statusCode = code;
        return res;
      },
      json(bodyJson){
        jsonBody = bodyJson;
        return res;
      }
    };
    await feedback.default(req, res);
    return { statusCode, jsonBody };
  }

  try {
    console.log('\n1) old shared app key still works');
    {
      __resetForTests();
      process.env.APP_ACCESS_KEY = 'admin_test_key';
      process.env.OWNER_LICENSE_KEYS = '';
      process.env.FOUNDER_LICENSE_KEYS = '';
      process.env.GOOGLE_SHEET_WEBHOOK_URL = 'https://example.test/feedback';
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return { ok: true };
      };

      const result = await callFeedback({ key: 'admin_test_key' });
      check('accepted old APP_ACCESS_KEY path', result.statusCode === 200 && result.jsonBody.status === 'ok');
      check('forwarded one feedback row to the sheet webhook', calls === 1);
    }

    console.log('\n2) owner/founder keys work for feedback too');
    {
      __resetForTests();
      process.env.APP_ACCESS_KEY = 'some_other_admin_key';
      process.env.OWNER_LICENSE_KEYS = 'test_owner_key';
      process.env.FOUNDER_LICENSE_KEYS = 'test_founder_key';
      process.env.GOOGLE_SHEET_WEBHOOK_URL = 'https://example.test/feedback';
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return { ok: true };
      };

      const ownerResult = await callFeedback({ key: 'test_owner_key' });
      const result = await callFeedback({ key: 'test_founder_key' });
      check('accepted owner key even though it is not APP_ACCESS_KEY', ownerResult.statusCode === 200 && ownerResult.jsonBody.status === 'ok');
      check('accepted founder key even though it is not APP_ACCESS_KEY', result.statusCode === 200 && result.jsonBody.status === 'ok');
      check('sent owner/founder feedback to the sheet webhook', calls === 2);
    }

    console.log('\n3) normal active license works');
    {
      __resetForTests();
      process.env.APP_ACCESS_KEY = 'some_other_admin_key';
      process.env.OWNER_LICENSE_KEYS = '';
      process.env.FOUNDER_LICENSE_KEYS = '';
      process.env.GOOGLE_SHEET_WEBHOOK_URL = 'https://example.test/feedback';
      const key = await svc.getOrCreateFreeLicense('feedback@example.com');
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return { ok: true };
      };

      const result = await callFeedback({ key });
      check('accepted active free license for feedback', result.statusCode === 200 && result.jsonBody.status === 'ok');
      check('sent licensed feedback to the sheet webhook', calls === 1);
    }

    console.log('\n4) random key is rejected before sheet write');
    {
      __resetForTests();
      process.env.APP_ACCESS_KEY = 'admin_test_key';
      process.env.OWNER_LICENSE_KEYS = '';
      process.env.FOUNDER_LICENSE_KEYS = 'test_founder_key';
      process.env.GOOGLE_SHEET_WEBHOOK_URL = 'https://example.test/feedback';
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return { ok: true };
      };

      const result = await callFeedback({ key: 'not_a_real_key' });
      check('invalid feedback key returns 401', result.statusCode === 401);
      check('invalid feedback key does not write to the sheet', calls === 0);
    }

    console.log('\n5) sheet failure is reported cleanly');
    {
      __resetForTests();
      process.env.APP_ACCESS_KEY = 'admin_test_key';
      process.env.OWNER_LICENSE_KEYS = '';
      process.env.FOUNDER_LICENSE_KEYS = '';
      process.env.GOOGLE_SHEET_WEBHOOK_URL = 'https://example.test/feedback';
      global.fetch = async () => ({ ok: false });

      const result = await callFeedback({ key: 'admin_test_key' });
      check('bad sheet response returns 502', result.statusCode === 502 && result.jsonBody.error === 'Failed to record feedback');
    }
  } finally {
    restoreEnv();
    global.fetch = originalFetch;
  }

  return getFailures();
};

if(require.main === module){
  module.exports().then(failures => {
    console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });
}
