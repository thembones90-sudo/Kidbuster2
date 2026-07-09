const puppeteer = require('puppeteer');
const { createChecker } = require('./helpers/assert.cjs');

const RUN_DIRECTLY = require.main === module;
const SHOULD_RUN_LIVE = process.env.KIDBUSTER_RUN_LIVE_SMOKE === '1' || RUN_DIRECTLY;
const { check, getFailures } = createChecker();

const LIVE_URL = process.env.KIDBUSTER_LIVE_URL || 'https://kidbuster.vercel.app/';
const EXPECTED_BUILD = '2026.07.09.2';

module.exports = async function run(){
  if(!SHOULD_RUN_LIVE){
    console.log('\n=== test-live-smoke.cjs ===');
    console.log('  SKIP  live smoke is opt-in; run npm run test:live after deployment');
    return 0;
  }

  console.log('\n=== test-live-smoke.cjs ===');
  console.log('Live URL:', LIVE_URL);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if(msg.type() === 'error') pageErrors.push(msg.text());
  });

  const response = await page.goto(LIVE_URL, { waitUntil: 'networkidle2', timeout: 45000 });
  check('live page returns HTTP 200', response && response.status() === 200);
  check('live page has no JavaScript errors on load', pageErrors.length === 0);
  if(pageErrors.length) console.log('    errors seen:', pageErrors);

  const initial = await page.evaluate(() => ({
    title: document.title,
    hasLogo: Boolean(document.getElementById('kbLogo')),
    hasAccountButton: Boolean(document.getElementById('accountBtn')),
    buildText: document.getElementById('accountBuild')?.textContent || '',
    coreBuild: typeof KidbusterCore !== 'undefined' ? KidbusterCore.KIDBUSTER_BUILD_LABEL : ''
  }));
  check('live page title contains Pathfinder', /Pathfinder/i.test(initial.title));
  check('live page renders the Pathfinder logo', initial.hasLogo);
  check('live page renders Access button', initial.hasAccountButton);
  check('live build marker is present in the Access panel markup', initial.buildText === EXPECTED_BUILD);
  check('live core build marker matches expected build', initial.coreBuild === EXPECTED_BUILD);

  const protocols = [
    { value: 'MA', label: 'Classic', bodyClass: null },
    { value: 'MS', label: 'Sugarcoat', bodyClass: 'protocol-ms', selector: '#protocolBadge .sugarcoat-lollipop' },
    { value: 'BLITZ', label: 'BLITZ', bodyClass: 'protocol-blitz', selector: '#protocolBadge .blitz-bolt' },
    { value: 'BEIDA', label: 'Beida', bodyClass: 'protocol-beida' },
    { value: 'OF', label: 'OF Protocol (Trial Evaluation)', bodyClass: 'protocol-of' }
  ];

  for(const proto of protocols){
    await page.click(`input[name="protocol"][value="${proto.value}"]`);
    await new Promise(resolve => setTimeout(resolve, 80));
    const result = await page.evaluate(selector => ({
      bodyClasses: Array.from(document.body.classList),
      badgeText: document.getElementById('protocolBadge').textContent,
      hasProtocolAsset: selector ? Boolean(document.querySelector(selector)) : true,
      voiceDisplay: document.getElementById('blitzVoiceField').style.display,
      voiceOptions: Array.from(document.querySelectorAll('#blitzVoiceSelect option')).map(option => option.value)
    }), proto.selector || '');

    check(proto.value + ': live badge text is correct', result.badgeText === proto.label);
    if(proto.bodyClass){
      check(proto.value + ': live body class is set', result.bodyClasses.includes(proto.bodyClass));
    }else{
      check(proto.value + ': live body class stays on default theme', result.bodyClasses.every(c => !c.startsWith('protocol-')));
    }
    check(proto.value + ': live protocol asset state is correct', result.hasProtocolAsset);
    if(proto.value === 'BLITZ'){
      check('BLITZ: live Voice dropdown is visible', result.voiceDisplay !== 'none');
      check('BLITZ: live Voice dropdown has warm/simple/polished', JSON.stringify(result.voiceOptions) === JSON.stringify(['warm','simple','polished']));
    }else{
      check(proto.value + ': live Voice dropdown is hidden outside Blitz', result.voiceDisplay === 'none');
    }
  }

  const assetChecks = await page.evaluate(async () => {
    const urls = [
      '/assets/blitz-bolt.png',
      '/assets/sugarcoat-lollipop.png',
      '/assets/classic-crosshair.png'
    ];
    const results = {};
    for(const url of urls){
      const response = await fetch(url, { cache: 'no-store' });
      results[url] = response.ok;
    }
    return results;
  });
  Object.entries(assetChecks).forEach(([url, ok]) => {
    check('live asset responds: ' + url, ok);
  });

  await browser.close();
  return getFailures();
};

if(require.main === module){
  module.exports().then(failures => {
    console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
