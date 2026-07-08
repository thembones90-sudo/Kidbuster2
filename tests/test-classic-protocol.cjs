'use strict';
const { extractKidbusterCore } = require('./helpers/extract-core.cjs');
const { createChecker } = require('./helpers/assert.cjs');

/**
 * Covers MA/Classic's foundational validator checks that predate this
 * whole test suite and were only ever touched incidentally by other test
 * files (length-format, trim-rule, wolf-emoji). Those all assume the
 * baseline checks below already work — this file is what actually proves
 * that assumption, for the protocol that's been in production the longest.
 */
module.exports = function run(){
  const KidbusterCore = extractKidbusterCore();
  const { check, getFailures } = createChecker();

  console.log('\n=== test-classic-protocol.cjs ===');

  // A deliberately valid, complete MA report at a mid rating (no Parent
  // Note expected) — the baseline every mutation test below starts from,
  // so each test changes exactly one thing and nothing else.
  function baseReport({ stars = '⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐', superpowerCount = 1, missionCount = 1, parentNote = false, grammarPointsBody = '1. Rule one\n   👉 Example one.\n   👉 Example two.' } = {}){
    const superpowerBlock = Array(superpowerCount).fill("Today's Superpower:\n🦸 Speaking\n\nGreat job today!").join('\n\n');
    const missions = ['Vocabulary Mission 🎯\nTask one.', 'Grammar Mission 🎯\nTask two.', 'Speaking Mission 🎯\nTask three.'].slice(0, missionCount).join('\n');
    const parentNoteBlock = parentNote ? 'Parent Note:\nA note for the parent about today.\n\n' : '';
    const starsBlock = stars === null ? [] : ['Total Stars Today:', '', stars, ''];
    return [
      'Hi Kaya!', '',
      "Today's Lesson:", '📚 Animals', '',
      'Key Vocabulary with Pronunciation & Notes:', '',
      'cat 🐱 – a small pet | Pronunciation: kat | Note: knew it well',
      'dog 🐶 – a loyal pet | Pronunciation: dawg | Note: used it in a sentence',
      'bird 🐦 – flies in the sky | Pronunciation: burd | Note: good recall',
      'fish 🐟 – lives in water | Pronunciation: fish | Note: easy for her',
      'rabbit 🐇 – hops around | Pronunciation: rab-it | Note: new word',
      'horse 🐴 – a big farm animal | Pronunciation: hors | Note: correct on first try',
      'sheep 🐑 – a fluffy animal | Pronunciation: sheep | Note: spotted it fast',
      'duck 🦆 – swims and quacks | Pronunciation: duk | Note: liked this one',
      'cow 🐄 – gives milk | Pronunciation: kow | Note: confident',
      'pig 🐖 – a pink farm animal | Pronunciation: pig | Note: clear pronunciation',
      '',
      'Grammar & Sentence Practice:', '',
      '"I have a cat."', '"She likes dogs."', '"We saw a bird."', '',
      'Grammar Points We Covered:', '',
      grammarPointsBody, '',
      superpowerBlock, '',
      parentNoteBlock +
      'Mini Homework:', '',
      missions, '',
      ...starsBlock,
      'Cheers,', 'Teacher Layne 🐺'
    ].join('\n');
  }

  console.log('\n1) A genuinely valid report produces zero warnings');
  {
    const report = baseReport();
    const warnings = KidbusterCore.analyzeMAOutput(report, '4', 'Layne');
    check('valid mid-rating report -> zero warnings', warnings.length === 0);
    if(warnings.length){ console.log('    (unexpected warnings:', warnings, ')'); }
  }

  console.log('\n2) Star rule: ratings above 3 need exactly 10; ratings 1 through 3 get none');
  {
    const nineStars = KidbusterCore.analyzeMAOutput(baseReport({ stars: '⭐⭐⭐⭐⭐⭐⭐⭐⭐' }), '4', 'Layne');
    check('9 stars -> flagged', nineStars.some(w => w.includes('Star count is 9')));

    const elevenStars = KidbusterCore.analyzeMAOutput(baseReport({ stars: '⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐' }), '4', 'Layne');
    check('11 stars -> flagged', elevenStars.some(w => w.includes('Star count is 11')));

    const tenStars = KidbusterCore.analyzeMAOutput(baseReport({ stars: '⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐' }), '4', 'Layne');
    check('exactly 10 stars -> not flagged', !tenStars.some(w => w.includes('Star count')));

    const lowPrompt = KidbusterCore.buildMASystemPrompt({ rating: '3', lengthFormat: 'long' });
    check('rating 3 prompt tells the model to omit Total Stars Today', lowPrompt.includes('OMIT the entire Total Stars Today section'));

    const highPrompt = KidbusterCore.buildMASystemPrompt({ rating: '4', lengthFormat: 'long' });
    check('rating 4 prompt tells the model to include exactly 10 stars', highPrompt.includes('INCLUDE it with exactly 10 star emojis'));

    const lowSweetPrompt = KidbusterCore.PROTOCOLS.MS.buildSystemPrompt({ rating: '3', lengthFormat: 'long' });
    check('Sugarcoat rating 3 prompt also tells the model to omit stars', lowSweetPrompt.includes('OMIT the entire Total Stars Today section'));

    const highSweetPrompt = KidbusterCore.PROTOCOLS.MS.buildSystemPrompt({ rating: '4', lengthFormat: 'long' });
    check('Sugarcoat rating 4 prompt also tells the model to include exactly 10 stars', highSweetPrompt.includes('INCLUDE it with exactly 10 star emojis'));

    ['1', '1.5', '2', '2.5', '3'].forEach(lvl => {
      const noStars = KidbusterCore.analyzeMAOutput(baseReport({ stars: null, parentNote: ['1', '1.5', '2', '2.5'].includes(lvl) }), lvl, 'Layne');
      check('rating ' + lvl + ' with no stars -> not flagged for stars', !noStars.some(w => w.toLowerCase().includes('star')));

      const hasStars = KidbusterCore.analyzeMAOutput(baseReport({ stars: '⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐', parentNote: ['1', '1.5', '2', '2.5'].includes(lvl) }), lvl, 'Layne');
      check('rating ' + lvl + ' with stars -> flagged as omitted', hasStars.some(w => w.includes('Total Stars Today should be omitted')));

      const sweetHasStars = KidbusterCore.PROTOCOLS.MS.analyze(baseReport({ stars: '⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐', parentNote: ['1', '1.5', '2', '2.5'].includes(lvl) }), lvl, 'Layne');
      check('Sugarcoat rating ' + lvl + ' with stars -> flagged as omitted', sweetHasStars.some(w => w.includes('Total Stars Today should be omitted')));
    });
  }

  console.log('\n3) Parent Note gating: required at 1/1.5/2/2.5, forbidden above 2.5');
  {
    ['1', '1.5', '2', '2.5'].forEach(lvl => {
      const missingWhenRequired = KidbusterCore.analyzeMAOutput(baseReport({ parentNote: false }), lvl, 'Layne');
      check('rating ' + lvl + ' without Parent Note -> flagged as missing', missingWhenRequired.some(w => w.includes('Parent Note') && w.includes('missing')));

      const presentWhenRequired = KidbusterCore.analyzeMAOutput(baseReport({ parentNote: true }), lvl, 'Layne');
      check('rating ' + lvl + ' with Parent Note -> not flagged', !presentWhenRequired.some(w => w.includes('Parent Note')));
    });

    ['3', '4', '5', '6'].forEach(lvl => {
      const presentWhenForbidden = KidbusterCore.analyzeMAOutput(baseReport({ parentNote: true }), lvl, 'Layne');
      check('rating ' + lvl + ' WITH Parent Note -> flagged as should-be-omitted', presentWhenForbidden.some(w => w.includes('Parent Note') && w.includes('omitted')));

      const absentWhenForbidden = KidbusterCore.analyzeMAOutput(baseReport({ parentNote: false }), lvl, 'Layne');
      check('rating ' + lvl + ' without Parent Note -> not flagged', !absentWhenForbidden.some(w => w.includes('Parent Note')));
    });
  }

  console.log('\n4) Exactly one Superpower emoji (🦸) required');
  {
    const zero = KidbusterCore.analyzeMAOutput(baseReport({ superpowerCount: 0 }), '4', 'Layne');
    check('0 superpower blocks -> flagged as missing', zero.some(w => w.includes('No "Today\'s Superpower"')));

    const two = KidbusterCore.analyzeMAOutput(baseReport({ superpowerCount: 2 }), '4', 'Layne');
    check('2 superpower blocks -> flagged as too many', two.some(w => w.includes('More than one Superpower')));

    const one = KidbusterCore.analyzeMAOutput(baseReport({ superpowerCount: 1 }), '4', 'Layne');
    check('exactly 1 superpower block -> not flagged', !one.some(w => w.includes('Superpower emoji')));
  }

  console.log('\n5) Exactly one homework mission required');
  {
    const zero = KidbusterCore.analyzeMAOutput(baseReport({ missionCount: 0 }), '4', 'Layne');
    check('0 missions -> flagged as missing', zero.some(w => w.includes('No homework mission')));

    const two = KidbusterCore.analyzeMAOutput(baseReport({ missionCount: 2 }), '4', 'Layne');
    check('2 missions -> flagged as too many', two.some(w => w.includes('Multiple homework missions')));

    const one = KidbusterCore.analyzeMAOutput(baseReport({ missionCount: 1 }), '4', 'Layne');
    check('exactly 1 mission -> not flagged', !one.some(w => w.includes('homework mission')));
  }

  console.log('\n6) Grammar Points We Covered must not be present-but-empty');
  {
    const empty = KidbusterCore.analyzeMAOutput(baseReport({ grammarPointsBody: '' }), '4', 'Layne');
    check('empty Grammar Points body -> flagged', empty.some(w => w.includes('appears empty')));

    const filled = KidbusterCore.analyzeMAOutput(baseReport(), '4', 'Layne');
    check('filled Grammar Points body -> not flagged', !filled.some(w => w.includes('appears empty')));
  }

  console.log('\n7) Forbidden formatting: no bold, no italics (shared across every protocol)');
  {
    const withBold = baseReport().replace('Great job today!', '**Great job today!**');
    const warnBold = KidbusterCore.analyzeMAOutput(withBold, '4', 'Layne');
    check('markdown bold (**text**) -> flagged', warnBold.some(w => w.toLowerCase().includes('bold')));

    const withItalic = baseReport().replace('Great job today!', '_Great job today!_');
    const warnItalic = KidbusterCore.analyzeMAOutput(withItalic, '4', 'Layne');
    check('markdown italic (_text_) -> flagged', warnItalic.some(w => w.toLowerCase().includes('italic')));

    const clean = KidbusterCore.analyzeMAOutput(baseReport(), '4', 'Layne');
    check('no markdown formatting -> not flagged for bold/italic', !clean.some(w => w.toLowerCase().includes('bold') || w.toLowerCase().includes('italic')));
  }

  console.log('\n8) Sign-off must exactly match "Cheers, / Teacher {name} 🐺" for Layne');
  {
    const wrongPhrase = baseReport().replace('Cheers,', 'Best wishes,');
    const warnWrongPhrase = KidbusterCore.analyzeMAOutput(wrongPhrase, '4', 'Layne');
    check('wrong closing phrase -> flagged', warnWrongPhrase.some(w => w.includes('sign-off')));

    const correct = KidbusterCore.analyzeMAOutput(baseReport(), '4', 'Layne');
    check('correct sign-off -> not flagged', !correct.some(w => w.includes('sign-off')));
  }

  console.log('\n9) Star-count fallback scoping: works even with no "Total Stars Today" header at all (Sugarcoat\'s format)');
  {
    // Sugarcoat deliberately no longer prints a "Total Stars Today" header
    // (see DECISIONS.md) — the validator falls back to scoping between
    // "Mini Homework" and the sign-off phrase instead of failing outright.
    function headerlessReport(stars){
      return [
        'Hi Kaya! 💖', '',
        "You did such wonderful work today learning about animals!", '',
        'Key Vocabulary with Pronunciation & Notes:', '',
        'cat 🐱 – a small pet | Pronunciation: kat | Note: knew it well', '',
        'Grammar & Sentence Practice:', '', '"I have a cat."', '"She likes dogs."', '"We saw a bird."', '',
        'Grammar Points We Covered:', '', '1. Rule one', '   👉 Ex 1', '   👉 Ex 2', '',
        'You showed such wonderful effort today, especially describing the animals so clearly!', '',
        'Mini Homework', '',
        'Vocabulary Mission 🎯', 'Practice three animal words at home.', '',
        'OR', '',
        'Speaking Mission 🎯', 'Tell someone at home about an animal.', '',
        stars, '',
        'What a joyful lesson — see you next time!', '',
        'Love,', 'Teacher Layne 💖'
      ].join('\n');
    }

    const tenStars = headerlessReport('⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐');
    const warnTen = KidbusterCore.PROTOCOLS.MS.analyze(tenStars, '4', 'Layne');
    check('10 stars, no header at all -> NOT flagged', !warnTen.some(w => w.toLowerCase().includes('star')));

    const eightStars = headerlessReport('⭐⭐⭐⭐⭐⭐⭐⭐');
    const warnEight = KidbusterCore.PROTOCOLS.MS.analyze(eightStars, '4', 'Layne');
    check('8 stars, no header at all -> flagged as wrong count (fallback scoping actually works, not just skipped)', warnEight.some(w => w.includes('Star count is 8')));

    const noHomeworkAtAll = headerlessReport('⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐').replace('Mini Homework', 'Something Else Entirely');
    const warnNoAnchor = KidbusterCore.PROTOCOLS.MS.analyze(noHomeworkAtAll, '4', 'Layne');
    check('neither header nor "Mini Homework" present -> falls back to "could not locate" rather than silently passing', warnNoAnchor.some(w => w.includes('Could not locate')));
  }

  return getFailures();
};

if(require.main === module){
  const failures = module.exports();
  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}
