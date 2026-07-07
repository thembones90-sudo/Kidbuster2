'use strict';
const { extractKidbusterCore } = require('./helpers/extract-core.cjs');
const { createChecker } = require('./helpers/assert.cjs');

module.exports = function run(){
  const KidbusterCore = extractKidbusterCore();
  const { check, getFailures } = createChecker();

  console.log('\n=== test-length-format.cjs ===');

  console.log('\n1) LENGTH_TIERS values match spec');
  const T = KidbusterCore.LENGTH_TIERS;
  check('short  soft=2200 hard=2400', T.short.softTarget === 2200 && T.short.hardCeiling === 2400);
  check('medium soft=2800 hard=3000', T.medium.softTarget === 2800 && T.medium.hardCeiling === 3000);
  check('long   soft=4500 hard=4800', T.long.softTarget === 4500 && T.long.hardCeiling === 4800);

  console.log('\n2) buildMASystemPrompt substitutes the right numbers per tier, no leftover tokens');
  ['short', 'medium', 'long', undefined, 'bogus-key'].forEach(tierKey => {
    const prompt = KidbusterCore.buildMASystemPrompt({ rating: '4', lengthFormat: tierKey });
    const expected = T[tierKey] || T.long; // documented default fallback is 'long'
    const hasNoTokens = !prompt.includes('__SOFT_TARGET__') && !prompt.includes('__HARD_CEILING__');
    const hasSoft = prompt.includes(String(expected.softTarget));
    const hasHard = prompt.includes(String(expected.hardCeiling));
    check('MA lengthFormat=' + tierKey + ' -> no leftover tokens', hasNoTokens);
    check('MA lengthFormat=' + tierKey + ' -> contains ' + expected.softTarget + '/' + expected.hardCeiling, hasSoft && hasHard);
  });

  console.log('\n3) buildSweetSystemPrompt (Sugarcoat) inherits the same substitution');
  ['short', 'medium', 'long'].forEach(tierKey => {
    const prompt = KidbusterCore.buildSweetSystemPrompt({ rating: '4', lengthFormat: tierKey });
    const expected = T[tierKey];
    const hasNoTokens = !prompt.includes('__SOFT_TARGET__') && !prompt.includes('__HARD_CEILING__');
    const hasSoft = prompt.includes(String(expected.softTarget));
    const hasHard = prompt.includes(String(expected.hardCeiling));
    check('Sugarcoat lengthFormat=' + tierKey + ' -> no leftover tokens', hasNoTokens);
    check('Sugarcoat lengthFormat=' + tierKey + ' -> contains ' + expected.softTarget + '/' + expected.hardCeiling, hasSoft && hasHard);
  });

  console.log('\n4) PROTOCOLS.MA / MS .analyze() apply the correct tier when validating output length');
  function makeFakeReport(charCount){
    return 'x'.repeat(charCount);
  }
  const cases = [
    { tierKey: 'short', hard: T.short.hardCeiling },
    { tierKey: 'medium', hard: T.medium.hardCeiling },
    { tierKey: 'long', hard: T.long.hardCeiling },
  ];
  cases.forEach(({ tierKey, hard }) => {
    const underText = makeFakeReport(hard - 50);
    const overText = makeFakeReport(hard + 50);

    const resultUnder = KidbusterCore.PROTOCOLS.MA.analyze(underText, '4', 'Layne', tierKey);
    const resultOver = KidbusterCore.PROTOCOLS.MA.analyze(overText, '4', 'Layne', tierKey);
    const underFlagged = resultUnder.some(w => w.includes('CRITICAL') && w.includes(String(hard)));
    const overFlagged = resultOver.some(w => w.includes('CRITICAL') && w.includes(String(hard)));
    check('MA ' + tierKey + ': ' + (hard - 50) + ' chars -> NOT flagged as over ' + hard, !underFlagged);
    check('MA ' + tierKey + ': ' + (hard + 50) + ' chars -> flagged as over ' + hard, overFlagged);

    const msResultOver = KidbusterCore.PROTOCOLS.MS.analyze(overText, '4', 'Layne', tierKey);
    const msOverFlagged = msResultOver.some(w => w.includes('CRITICAL') && w.includes(String(hard)));
    check('MS(Sugarcoat) ' + tierKey + ': ' + (hard + 50) + ' chars -> flagged as over ' + hard, msOverFlagged);
  });

  console.log('\n5) Default (no lengthFormat passed at all) behaves exactly like "long" -- backward compatibility');
  {
    const promptNoArg = KidbusterCore.buildMASystemPrompt({ rating: '4' });
    check('buildMASystemPrompt with no lengthFormat contains 4500/4800', promptNoArg.includes('4500') && promptNoArg.includes('4800'));

    const overLong = makeFakeReport(T.long.hardCeiling + 50);
    const resultNoArg = KidbusterCore.PROTOCOLS.MA.analyze(overLong, '4', 'Layne'); // no lengthFormat arg at all
    const flaggedAt4800 = resultNoArg.some(w => w.includes('4800'));
    check('analyze() with no lengthFormat arg -> flags at 4800 (long default)', flaggedAt4800);
  }

  console.log('\n6) OF protocol is untouched (no lengthFormat plumbing, own separate limits)');
  {
    const ofPrompt = KidbusterCore.buildOFSystemPrompt({ rating: 'Medium' });
    check('OF prompt has no leftover length tokens', !ofPrompt.includes('__SOFT_TARGET__') && !ofPrompt.includes('__HARD_CEILING__'));
  }

  return getFailures();
};

if(require.main === module){
  const failures = module.exports();
  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}
