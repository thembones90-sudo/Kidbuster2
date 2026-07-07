'use strict';
const { extractKidbusterCore } = require('./helpers/extract-core.cjs');
const { createChecker } = require('./helpers/assert.cjs');

module.exports = function run(){
  const KidbusterCore = extractKidbusterCore();
  const { check, getFailures } = createChecker();

  console.log('\n=== test-trim-rule.cjs ===');

  console.log('\n1) The trim rule text actually lands in the generated prompt, per tier');
  ['short','medium','long'].forEach(tierKey => {
    const prompt = KidbusterCore.buildMASystemPrompt({ rating: '4', lengthFormat: tierKey });
    const tier = KidbusterCore.LENGTH_TIERS[tierKey];
    check('MA ' + tierKey + ' prompt contains its trimRule text verbatim', prompt.includes(tier.trimRule));
    check('MA ' + tierKey + ' prompt has no leftover __LENGTH_TRIM_RULE__ token', !prompt.includes('__LENGTH_TRIM_RULE__'));
  });
  ['short','medium','long'].forEach(tierKey => {
    const prompt = KidbusterCore.buildSweetSystemPrompt({ rating: '4', lengthFormat: tierKey });
    const tier = KidbusterCore.LENGTH_TIERS[tierKey];
    check('Sugarcoat ' + tierKey + ' prompt contains its trimRule text verbatim', prompt.includes(tier.trimRule));
  });

  console.log('\n2) Short-tier trim rule specifics are worded as mandatory, not suggested');
  check('short trimRule says "mandatory, not optional"', KidbusterCore.LENGTH_TIERS.short.trimRule.includes('mandatory, not optional'));
  check('short trimRule requires omitting Pronunciation Focus', KidbusterCore.LENGTH_TIERS.short.trimRule.includes('Omit the Pronunciation Focus'));
  check('short trimRule requires dropping per-word Pronunciation field', KidbusterCore.LENGTH_TIERS.short.trimRule.includes('omit the "| Pronunciation:'));
  check('short trimRule caps grammar points at 1', KidbusterCore.LENGTH_TIERS.short.trimRule.includes('at most 1 grammar point'));
  check('short trimRule caps examples at 2', KidbusterCore.LENGTH_TIERS.short.trimRule.includes('only 2 example sentences'));
  check('medium trimRule caps grammar points at 3', KidbusterCore.LENGTH_TIERS.medium.trimRule.includes('at most 3 grammar points'));
  check('long trimRule imposes no reduction', KidbusterCore.LENGTH_TIERS.long.trimRule.includes('no additional content reduction'));

  console.log('\n3) Validator catches non-compliance with the Short trim rule');
  {
    const reportWithPronunciation = [
      'Hi Sam!', '', "Today's Lesson:", '📚 Test', '',
      'Key Vocabulary with Pronunciation & Notes:', '', 'word 🐑 – def | Pronunciation: x | Note: ok', '',
      'Pronunciation Focus:', '', '🗣 word → cue', '', 'Grammar & Sentence Practice:', '',
      '"Example."', '', 'Grammar Points We Covered:', '', '1. Rule one', '   👉 Ex 1', '   👉 Ex 2', '',
      "Today's Superpower:", '🦸 Speaking', '', 'Great job!', '', 'Mini Homework:', '', 'Vocabulary Mission 🎯', 'Task.', '',
      'Total Stars Today:', '⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐', '', 'Cheers,', 'Teacher Layne 🐺'
    ].join('\n');

    const warnings = KidbusterCore.PROTOCOLS.MA.analyze(reportWithPronunciation, '4', 'Layne', 'short');
    const flagged = warnings.some(w => w.includes('must omit Pronunciation Focus'));
    check('Short report WITH Pronunciation Focus content -> flagged', flagged);

    const warningsMedium = KidbusterCore.PROTOCOLS.MA.analyze(reportWithPronunciation, '4', 'Layne', 'medium');
    const flaggedMedium = warningsMedium.some(w => w.includes('must omit Pronunciation Focus'));
    check('Same report under Medium tier -> NOT flagged for Pronunciation Focus (rule is Short-only)', !flaggedMedium);
  }

  console.log('\n4) Validator catches too many grammar points for Short/Medium, but not for Long');
  function reportWithNGrammarPoints(n){
    const points = [];
    for(let i=1;i<=n;i++){
      points.push((i) + '. Rule ' + i, '   👉 Ex A', '   👉 Ex B', '');
    }
    return [
      'Hi Sam!', '', "Today's Lesson:", '📚 Test', '',
      'Key Vocabulary with Pronunciation & Notes:', '', 'word 🐑 – def | Pronunciation: x | Note: ok', '',
      'Grammar & Sentence Practice:', '', '"Example."', '',
      'Grammar Points We Covered:', ''
    ].concat(points).concat([
      "Today's Superpower:", '🦸 Speaking', '', 'Great job!', '', 'Mini Homework:', '', 'Vocabulary Mission 🎯', 'Task.', '',
      'Total Stars Today:', '⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐', '', 'Cheers,', 'Teacher Layne 🐺'
    ]).join('\n');
  }

  {
    const twoPoints = reportWithNGrammarPoints(2);
    const warnShort = KidbusterCore.PROTOCOLS.MA.analyze(twoPoints, '4', 'Layne', 'short');
    check('Short + 2 grammar points -> flagged (cap is 1)', warnShort.some(w => w.includes('grammar points')));

    const onePoint = reportWithNGrammarPoints(1);
    const warnShort1 = KidbusterCore.PROTOCOLS.MA.analyze(onePoint, '4', 'Layne', 'short');
    check('Short + 1 grammar point -> NOT flagged (cap is 1)', !warnShort1.some(w => w.includes('grammar points')));

    const threePoints = reportWithNGrammarPoints(3);
    const warnMedium = KidbusterCore.PROTOCOLS.MA.analyze(threePoints, '4', 'Layne', 'medium');
    check('Medium + 3 grammar points -> NOT flagged (cap is 3)', !warnMedium.some(w => w.includes('grammar points')));

    const fourPoints = reportWithNGrammarPoints(4);
    const warnMedium4 = KidbusterCore.PROTOCOLS.MA.analyze(fourPoints, '4', 'Layne', 'medium');
    check('Medium + 4 grammar points -> flagged (cap is 3)', warnMedium4.some(w => w.includes('grammar points')));

    const warnLong4 = KidbusterCore.PROTOCOLS.MA.analyze(fourPoints, '4', 'Layne', 'long');
    check('Long + 4 grammar points -> NOT flagged (no cap on Long)', !warnLong4.some(w => w.includes('grammar points')));
  }

  console.log('\n5) Validator catches per-word Pronunciation field left in Key Vocabulary (Short only)');
  function reportWithVocabFormat(includePronunciation){
    const vocabLine = includePronunciation
      ? 'word 🐑 – def | Pronunciation: WERD | Note: ok'
      : 'word 🐑 – def | Note: ok';
    return [
      'Hi Sam!', '', "Today's Lesson:", '📚 Test', '',
      'Key Vocabulary with Pronunciation & Notes:', '', vocabLine, '',
      'Grammar & Sentence Practice:', '', '"Example one."', '"Example two."', '',
      'Grammar Points We Covered:', '', '1. Rule', '   👉 Ex A', '   👉 Ex B', '',
      "Today's Superpower:", '🦸 Speaking', '', 'Great job!', '', 'Mini Homework:', '', 'Vocabulary Mission 🎯', 'Task.', '',
      'Total Stars Today:', '⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐', '', 'Cheers,', 'Teacher Layne 🐺'
    ].join('\n');
  }
  {
    const withPron = reportWithVocabFormat(true);
    const withoutPron = reportWithVocabFormat(false);

    const warnShortWith = KidbusterCore.PROTOCOLS.MA.analyze(withPron, '4', 'Layne', 'short');
    check('Short + per-word Pronunciation field present -> flagged', warnShortWith.some(w => w.includes('Key Vocabulary line')));

    const warnShortWithout = KidbusterCore.PROTOCOLS.MA.analyze(withoutPron, '4', 'Layne', 'short');
    check('Short + per-word Pronunciation field absent -> NOT flagged', !warnShortWithout.some(w => w.includes('Key Vocabulary line')));

    const warnMediumWith = KidbusterCore.PROTOCOLS.MA.analyze(withPron, '4', 'Layne', 'medium');
    check('Medium + per-word Pronunciation field present -> NOT flagged (rule is Short-only)', !warnMediumWith.some(w => w.includes('Key Vocabulary line')));
  }

  console.log('\n6) Validator catches too many Grammar & Sentence Practice examples (Short only)');
  function reportWithNExamples(n){
    const examples = [];
    for(let i=1;i<=n;i++){ examples.push('"Example ' + i + '."'); }
    return [
      'Hi Sam!', '', "Today's Lesson:", '📚 Test', '',
      'Key Vocabulary with Pronunciation & Notes:', '', 'word 🐑 – def | Note: ok', '',
      'Grammar & Sentence Practice:', ''
    ].concat(examples).concat([
      '', 'Grammar Points We Covered:', '', '1. Rule', '   👉 Ex A', '   👉 Ex B', '',
      "Today's Superpower:", '🦸 Speaking', '', 'Great job!', '', 'Mini Homework:', '', 'Vocabulary Mission 🎯', 'Task.', '',
      'Total Stars Today:', '⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐', '', 'Cheers,', 'Teacher Layne 🐺'
    ]).join('\n');
  }
  {
    const threeEx = reportWithNExamples(3);
    const warnShort = KidbusterCore.PROTOCOLS.MA.analyze(threeEx, '4', 'Layne', 'short');
    check('Short + 3 examples -> flagged (cap is 2)', warnShort.some(w => w.includes('Practice examples')));

    const twoEx = reportWithNExamples(2);
    const warnShort2 = KidbusterCore.PROTOCOLS.MA.analyze(twoEx, '4', 'Layne', 'short');
    check('Short + 2 examples -> NOT flagged (cap is 2)', !warnShort2.some(w => w.includes('Practice examples')));

    const warnMedium3 = KidbusterCore.PROTOCOLS.MA.analyze(threeEx, '4', 'Layne', 'medium');
    check('Medium + 3 examples -> NOT flagged (rule is Short-only)', !warnMedium3.some(w => w.includes('Practice examples')));
  }

  return getFailures();
};

if(require.main === module){
  const failures = module.exports();
  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}
