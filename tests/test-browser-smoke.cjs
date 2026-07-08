'use strict';
const path = require('path');
const { createChecker } = require('./helpers/assert.cjs');

/**
 * Loads the REAL index.html in an actual headless browser and drives it
 * like a person would — this exists specifically because every other
 * test file in this suite extracts and tests pure logic (KidbusterCore,
 * the usage-stats block) without ever loading the page itself. That
 * approach is fast and reliable for prompt/validator logic, but it can
 * never catch a bug in the surrounding UI wiring itself — which is
 * exactly what happened once: a `const copyBtn` declared AFTER the
 * function that referenced it created a temporal-dead-zone ReferenceError
 * that silently crashed the rest of the script's top-level execution on
 * every page load. Every protocol's theme CSS variable (driven by a
 * JS-independent `:has()` fallback) kept working and looked fine, which
 * is exactly why it went unnoticed — but the Generate button's own
 * gradient (which has no such fallback) stayed stuck on the default
 * green for every protocol, and the header badge text never updated
 * again after the very first page load. No prompt/validator test could
 * ever have caught that; only actually loading the page can.
 */
const fs = require('fs');

/**
 * Returns { puppeteer, launchOptions }. Prefers a real installed
 * `puppeteer` (added as a devDependency — manages its own downloaded
 * Chromium, no extra config needed). Falls back to the copy bundled with
 * a globally-installed @mermaid-js/mermaid-cli if that's the only one
 * available (as it was in the environment this was originally written
 * in) — that fallback needs an explicit executablePath since it doesn't
 * necessarily manage its own browser cache the same way.
 */
function loadPuppeteer(){
  try {
    return { puppeteer: require('puppeteer'), launchOptions: {} };
  } catch (e) {
    const fallbackModulePath = '/usr/local/lib/node_modules_global/@mermaid-js/mermaid-cli/node_modules/puppeteer';
    const puppeteer = require(fallbackModulePath); // absolute path — bypasses mermaid-cli's package.json "exports" map, which blocks a deep subpath require() by name
    const cacheDirsToCheck = [
      `${process.env.HOME || ''}/.cache/puppeteer/chrome`,
      '/root/.cache/puppeteer/chrome',
      '/home/claude/.cache/puppeteer/chrome'
    ];
    const candidateChromePaths = [];
    cacheDirsToCheck.forEach(dir => {
      if(fs.existsSync(dir)){
        fs.readdirSync(dir).forEach(v => candidateChromePaths.push(`${dir}/${v}/chrome-linux64/chrome`));
      }
    });
    const executablePath = candidateChromePaths.find(p => fs.existsSync(p));
    if(!executablePath){
      throw new Error('found a bundled puppeteer but no downloaded Chrome binary alongside it');
    }
    return { puppeteer, launchOptions: { executablePath } };
  }
}

module.exports = async function run(){
  const { check, getFailures } = createChecker();
  console.log('\n=== test-browser-smoke.cjs ===');

  let puppeteer, launchOptions;
  try {
    ({ puppeteer, launchOptions } = loadPuppeteer());
  } catch (e) {
    console.log('  SKIPPED — no usable puppeteer + Chrome install found in this environment (' + e.message + ').');
    console.log('  This is the one test file that requires an actual browser; every other file in');
    console.log('  this suite still runs and covers the app\'s logic without it.');
    return 0; // don't fail the whole suite just because this optional browser test can't run here
  }

  const indexPath = 'file://' + path.join(__dirname, '..', 'index.html');
  const browser = await puppeteer.launch({ args: ['--no-sandbox'], ...launchOptions });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto(indexPath);
  await new Promise(r => setTimeout(r, 150));

  console.log('\n1) Page loads with zero uncaught JavaScript errors');
  check('no page errors on initial load', pageErrors.length === 0);
  if(pageErrors.length){ console.log('    errors seen:', pageErrors); }

  console.log('\n2) Every protocol correctly sets its own body class AND its own button gradient — not just its :has()-driven panel colors');
  const protocols = [
    { value: 'MA',    bodyClass: null, label: 'Classic' }, // MA is the default theme — no body class of its own
    { value: 'MS',    bodyClass: 'protocol-ms', label: 'Sugarcoat' },
    { value: 'BLITZ', bodyClass: 'protocol-blitz', label: 'Blitz' },
    { value: 'BEIDA', bodyClass: 'protocol-beida', label: 'Beida' },
    { value: 'OF',    bodyClass: 'protocol-of', label: 'OF Protocol (Trial Evaluation)' }
  ];

  const seenBackgrounds = new Set();
  for(const proto of protocols){
    await page.click(`input[name="protocol"][value="${proto.value}"]`);
    await new Promise(r => setTimeout(r, 80));

    const result = await page.evaluate(() => {
      const btn = document.querySelector('.generate-btn');
      return {
        bodyClassList: Array.from(document.body.classList),
        background: getComputedStyle(btn).backgroundImage,
        badgeText: document.getElementById('protocolBadge').textContent
      };
    });

    if(proto.bodyClass){
      check(proto.value + ': body has "' + proto.bodyClass + '" class', result.bodyClassList.includes(proto.bodyClass));
    }else{
      check(proto.value + ': body has no protocol-specific class (uses the default theme)', result.bodyClassList.every(c => !c.startsWith('protocol-')));
    }
    check(proto.value + ': header badge text updates to match ("' + proto.label + '")', result.badgeText === proto.label);
    check(proto.value + ": Generate button's own background is a genuinely distinct gradient, not stuck on another theme's", !seenBackgrounds.has(result.background));
    seenBackgrounds.add(result.background);
  }

  console.log('\n3) License modal: shows correctly, validates client-side, stores a pasted key without needing a live backend');
  {
    const modalShown = await page.evaluate(() => {
      window.__testModalPromise = promptForAccessKey();
      const overlay = document.getElementById('licenseModalOverlay');
      return getComputedStyle(overlay).display !== 'none';
    });
    check('calling promptForAccessKey() shows the modal', modalShown);

    // Clicking "Get my free key" with no email entered should show a
    // client-side validation error WITHOUT attempting any network call
    // (there's no live backend for this file:// test to talk to).
    await page.click('#licenseModalFreeBtn');
    await new Promise(r => setTimeout(r, 80));
    const emptyEmailError = await page.evaluate(() => {
      const err = document.getElementById('licenseModalError');
      return { visible: err.style.display !== 'none', text: err.textContent };
    });
    check('empty email -> client-side validation error shown, no crash', emptyEmailError.visible && emptyEmailError.text.length > 0);

    // Pasting an existing key and clicking Continue should work entirely
    // client-side (no network call needed for this path at all) and
    // resolve the pending promise.
    await page.type('#licenseModalKeyInput', 'kb_live_test_pasted_key');
    await page.click('#licenseModalKeyBtn');
    await new Promise(r => setTimeout(r, 80));

    const afterPaste = await page.evaluate(async () => {
      const resolvedKey = await window.__testModalPromise;
      const overlay = document.getElementById('licenseModalOverlay');
      let stored = null;
      try{ stored = localStorage.getItem(ACCESS_KEY_STORAGE); }catch(e){ /* ignore */ }
      return {
        resolvedKey,
        overlayHidden: getComputedStyle(overlay).display === 'none',
        stored
      };
    });
    check('promptForAccessKey() resolves with the pasted key', afterPaste.resolvedKey === 'kb_live_test_pasted_key');
    check('modal hides itself after a successful entry', afterPaste.overlayHidden);
    check('the key is persisted to localStorage under ACCESS_KEY_STORAGE', afterPaste.stored === 'kb_live_test_pasted_key');
  }

  console.log('\n4) No new page errors accumulated from clicking through every protocol and the license modal');
  check('still zero page errors after full interaction', pageErrors.length === 0);

  await browser.close();
  return getFailures();
};

if(require.main === module){
  module.exports().then(failures => {
    console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });
}
