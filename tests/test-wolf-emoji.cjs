'use strict';
const { extractKidbusterCore } = require('./helpers/extract-core.cjs');
const { createChecker } = require('./helpers/assert.cjs');

module.exports = function run(){
  const KidbusterCore = extractKidbusterCore();
  const { check, getFailures } = createChecker();

  console.log('\n=== test-wolf-emoji.cjs ===');

  console.log('\n1) applyTeacherIdentity: pure name substitution only, no emoji logic at all');
  {
    const promptLayne = KidbusterCore.buildMASystemPrompt({ rating: '4', lengthFormat: 'long' });

    const promptLayneIdentity = KidbusterCore.applyTeacherIdentity(promptLayne, 'Layne');
    check('Layne (explicit) -> prompt still contains 🐺 (untouched, name-sub is a no-op)', promptLayneIdentity.includes('🐺'));

    const promptDefault = KidbusterCore.applyTeacherIdentity(promptLayne, '');
    check('empty teacher name -> defaults to Layne, prompt still contains 🐺', promptDefault.includes('🐺'));

    const promptNina = KidbusterCore.applyTeacherIdentity(promptLayne, 'Nina');
    check('Nina -> name substituted to "Teacher Nina"', promptNina.includes('Teacher Nina'));
    check('Nina -> no leftover "Layne" anywhere', !promptNina.includes('Layne'));
    check('Nina -> applyTeacherIdentity alone does NOT strip 🐺 (that\'s applyMASignoffEmoji\'s job now)', promptNina.includes('🐺'));
  }

  console.log('\n2) applyMASignoffEmoji: default behavior unchanged (Layne=wolf, others=none) when no custom emoji given');
  {
    const promptLayne = KidbusterCore.applyTeacherIdentity(KidbusterCore.buildMASystemPrompt({ rating: '4', lengthFormat: 'long' }), 'Layne');
    const finalLayne = KidbusterCore.applyMASignoffEmoji(promptLayne, 'Layne');
    check('Layne, no custom emoji -> still gets 🐺 by default', finalLayne.includes('Teacher Layne 🐺'));

    const promptNina = KidbusterCore.applyTeacherIdentity(KidbusterCore.buildMASystemPrompt({ rating: '4', lengthFormat: 'long' }), 'Nina');
    const finalNina = KidbusterCore.applyMASignoffEmoji(promptNina, 'Nina');
    check('Nina, no custom emoji -> no emoji at all (default for non-Layne)', finalNina.includes('Teacher Nina') && !finalNina.includes('🐺'));
    const promptFaye = KidbusterCore.applyTeacherIdentity(KidbusterCore.buildMASystemPrompt({ rating: '4', lengthFormat: 'long' }), 'Faye');
    const finalFaye = KidbusterCore.applyMASignoffEmoji(promptFaye, 'Faye');
    check('Faye, no custom emoji -> gets 🧚 by hidden default', finalFaye.includes('Teacher Faye 🧚') && !finalFaye.includes('ðŸº'));
    const promptSissy = KidbusterCore.applyTeacherIdentity(KidbusterCore.buildMASystemPrompt({ rating: '4', lengthFormat: 'long' }), 'Sissy');
    const finalSissy = KidbusterCore.applyMASignoffEmoji(promptSissy, 'Sissy');
    check('Sissy, no custom emoji -> gets 🌻 by hidden default', finalSissy.includes('Teacher Sissy 🌻'));
  }

  console.log('\n3) applyMASignoffEmoji: any teacher can opt into their own custom sign-off emoji');
  {
    const promptNinaRaw = KidbusterCore.applyTeacherIdentity(KidbusterCore.buildMASystemPrompt({ rating: '4', lengthFormat: 'long' }), 'Nina');
    const ninaWithFox = KidbusterCore.applyMASignoffEmoji(promptNinaRaw, 'Nina', '🦊');
    check('Nina + custom "🦊" -> gets her own emoji, not the wolf', ninaWithFox.includes('Teacher Nina 🦊') && !ninaWithFox.includes('🐺'));

    const promptLayneRaw = KidbusterCore.applyTeacherIdentity(KidbusterCore.buildMASystemPrompt({ rating: '4', lengthFormat: 'long' }), 'Layne');
    const layneWithHeart = KidbusterCore.applyMASignoffEmoji(promptLayneRaw, 'Layne', '💜');
    check('Layne + custom "💜" -> gets the custom emoji instead of her default wolf', layneWithHeart.includes('Teacher Layne 💜') && !layneWithHeart.includes('🐺'));

    const ninaExplicitlyWantsWolfToo = KidbusterCore.applyMASignoffEmoji(promptNinaRaw, 'Nina', '🐺');
    check('Nina can explicitly opt INTO the wolf too, if she wants it', ninaExplicitlyWantsWolfToo.includes('Teacher Nina 🐺'));

    const blankCustomEmoji = KidbusterCore.applyMASignoffEmoji(promptNinaRaw, 'Nina', '   '); // whitespace-only counts as blank
    check('whitespace-only custom emoji is treated as blank -> falls back to default (none for Nina)', !blankCustomEmoji.includes('🐺'));
  }

  console.log('\n4) Validator: expects the correct emoji (default or custom) via PROTOCOLS.MA.analyze\'s 6th arg');
  function makeReport(teacherLine){
    return [
      'Hi Sam!', '', "Today's Lesson:", '📚 Test', '',
      'Key Vocabulary with Pronunciation & Notes:', '', 'word 🐑 – def | Pronunciation: WERD | Note: ok', '',
      'Grammar & Sentence Practice:', '', '"Example one."', '"Example two."', '"Example three."', '',
      "Today's Superpower:", '🦸 Speaking', '', 'Great job!', '', 'Mini Homework:', '', 'Vocabulary Mission 🎯', 'Task.', '',
      'Total Stars Today:', '⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐', '', 'Cheers,', teacherLine
    ].join('\n');
  }
  {
    const reportLayne = makeReport('Teacher Layne 🐺');
    const warnLayne = KidbusterCore.PROTOCOLS.MA.analyze(reportLayne, '4', 'Layne', 'long', '', '');
    check('Layne, no override + "Teacher Layne 🐺" -> sign-off NOT flagged', !warnLayne.some(w => w.includes('sign-off')));

    const reportLayneNoEmoji = makeReport('Teacher Layne');
    const warnLayneNoEmoji = KidbusterCore.PROTOCOLS.MA.analyze(reportLayneNoEmoji, '4', 'Layne', 'long', '', '');
    check('Layne, no override + missing 🐺 -> sign-off IS flagged (emoji required by default)', warnLayneNoEmoji.some(w => w.includes('sign-off')));

    const reportNinaNoEmoji = makeReport('Teacher Nina');
    const warnNinaNoEmoji = KidbusterCore.PROTOCOLS.MA.analyze(reportNinaNoEmoji, '4', 'Nina', 'long', '', '');
    check('Nina, no override + "Teacher Nina" (no emoji) -> sign-off NOT flagged (default for non-Layne)', !warnNinaNoEmoji.some(w => w.includes('sign-off')));

    const reportNinaWithWolf = makeReport('Teacher Nina 🐺');
    const warnNinaWithWolf = KidbusterCore.PROTOCOLS.MA.analyze(reportNinaWithWolf, '4', 'Nina', 'long', '', '');
    check('Nina, no override + "Teacher Nina 🐺" -> sign-off IS flagged (default for non-Layne is still no emoji)', warnNinaWithWolf.some(w => w.includes('sign-off')));

    const reportNinaWithFox = makeReport('Teacher Nina 🦊');
    const warnNinaWithFoxNoOverride = KidbusterCore.PROTOCOLS.MA.analyze(reportNinaWithFox, '4', 'Nina', 'long', '', '');
    check('Nina + "🦊" but NO override passed -> flagged (validator still expects no emoji by default)', warnNinaWithFoxNoOverride.some(w => w.includes('sign-off')));

    const warnNinaWithFoxAndOverride = KidbusterCore.PROTOCOLS.MA.analyze(reportNinaWithFox, '4', 'Nina', 'long', '', '🦊');
    check('Nina + "🦊" WITH matching override -> NOT flagged (validator now expects her custom emoji)', !warnNinaWithFoxAndOverride.some(w => w.includes('sign-off')));

    const warnLayneWithHeartAndOverride = KidbusterCore.PROTOCOLS.MA.analyze(makeReport('Teacher Layne 💜'), '4', 'Layne', 'long', '', '💜');
    check('Layne + custom "💜" override -> NOT flagged (Layne can override her own default too)', !warnLayneWithHeartAndOverride.some(w => w.includes('sign-off')));
  }

  {
    const warnFayeWithFairy = KidbusterCore.PROTOCOLS.MA.analyze(makeReport('Teacher Faye 🧚'), '4', 'Faye', 'long', '', '');
    check('Faye, no override + "Teacher Faye 🧚" -> sign-off NOT flagged', !warnFayeWithFairy.some(w => w.includes('sign-off')));

    const warnFayeNoFairy = KidbusterCore.PROTOCOLS.MA.analyze(makeReport('Teacher Faye'), '4', 'Faye', 'long', '', '');
    check('Faye, no override + missing 🧚 -> sign-off IS flagged', warnFayeNoFairy.some(w => w.includes('sign-off')));
  }

  console.log('\n5) Sweet Voice (MS) keeps its heart and adds Faye hidden fairy before it');
  {
    const msPromptNina = KidbusterCore.applyTeacherIdentity(
      KidbusterCore.buildSweetSystemPrompt({ rating: '4', lengthFormat: 'long' }),
      'Nina'
    );
    check('MS prompt for Nina still contains 💖 untouched', msPromptNina.includes('💖'));
    check('MS prompt for Nina contains no 🐺 (never did)', !msPromptNina.includes('🐺'));

    function makeMSReport(teacherLine){
      return [
        'Hi Sam!', '', "Today's Lesson:", '📚 Test', '',
        'Key Vocabulary with Pronunciation & Notes:', '', 'word 🐑 – def | Pronunciation: WERD | Note: ok', '',
        'Grammar & Sentence Practice:', '', '"Example one."', '"Example two."', '"Example three."', '',
        'Great job!', '', 'Mini Homework:', '', 'Vocabulary Mission 🎯', 'Task.', '',
        'Total Stars Today:', '⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐', '', 'Love,', teacherLine
      ].join('\n');
    }
    const msReportNina = makeMSReport('Teacher Nina 💖');
    const warnMS = KidbusterCore.PROTOCOLS.MS.analyze(msReportNina, '4', 'Nina', 'long', '', '🦊');
    check('MS + Nina + "Teacher Nina 💖" (even with an unrelated signoffEmoji arg passed) -> sign-off NOT flagged', !warnMS.some(w => w.includes('sign-off')));
    const msPromptFaye = KidbusterCore.applyProtocolSignoffEmoji(
      KidbusterCore.applyTeacherIdentity(KidbusterCore.buildSweetSystemPrompt({ rating: '4', lengthFormat: 'long' }), 'Faye'),
      'Faye',
      'MS'
    );
    check('MS prompt for Faye includes "Teacher Faye 🧚 💖"', msPromptFaye.includes('Teacher Faye 🧚 💖'));

    const msReportFaye = makeMSReport('Teacher Faye 🧚 💖');
    const warnMSFaye = KidbusterCore.PROTOCOLS.MS.analyze(msReportFaye, '4', 'Faye', 'long', '', '');
    check('MS + Faye + "Teacher Faye 🧚 💖" -> sign-off NOT flagged', !warnMSFaye.some(w => w.includes('sign-off')));

    const msPromptSissy = KidbusterCore.applyProtocolSignoffEmoji(
      KidbusterCore.applyTeacherIdentity(KidbusterCore.buildSweetSystemPrompt({ rating: '4', lengthFormat: 'long' }), 'Sissy'),
      'Sissy',
      'MS'
    );
    check('MS prompt for Sissy includes "Teacher Sissy 🌻 💖"', msPromptSissy.includes('Teacher Sissy 🌻 💖'));

    const msReportSissy = makeMSReport('Teacher Sissy 🌻 💖');
    const warnMSSissy = KidbusterCore.PROTOCOLS.MS.analyze(msReportSissy, '4', 'Sissy', 'long', '', '');
    check('MS + Sissy + "Teacher Sissy 🌻 💖" -> sign-off NOT flagged', !warnMSSissy.some(w => w.includes('sign-off')));
  }

  return getFailures();
};

if(require.main === module){
  const failures = module.exports();
  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}
