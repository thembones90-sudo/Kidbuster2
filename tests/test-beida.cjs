'use strict';
const { extractKidbusterCore } = require('./helpers/extract-core.cjs');
const { createChecker } = require('./helpers/assert.cjs');

/**
 * Covers the Beida protocol — built to match an existing external
 * platform's real two-field comment form (BetaKid: "Learning Content" +
 * "General and Detailed Performance"), not our own invented structure.
 * Tests the prompt content, the dual-field split/parse logic, the
 * validator's per-field checks, and the rating-driven guidance.
 */
module.exports = function run(){
  const KidbusterCore = extractKidbusterCore();
  const { check, getFailures } = createChecker();

  console.log('\n=== test-beida.cjs ===');

  console.log('\n1) Registry wiring');
  check('PROTOCOLS.BEIDA exists', !!KidbusterCore.PROTOCOLS.BEIDA);
  check('PROTOCOLS.BEIDA.label is "Beida"', KidbusterCore.PROTOCOLS.BEIDA.label === 'Beida');
  check('BEIDA_RATING_TIERS has exactly excellent/try_harder', Object.keys(KidbusterCore.BEIDA_RATING_TIERS).sort().join(',') === 'excellent,try_harder');
  check('BEIDA_RATING_TIERS labels match BetaKid\'s real field exactly', KidbusterCore.BEIDA_RATING_TIERS.excellent.label === 'Excellent' && KidbusterCore.BEIDA_RATING_TIERS.try_harder.label === 'try harder please');

  console.log('\n2) Prompt content: Lesson Evidence Rule, Safe Inference Principle, rating-driven guidance, dual-field rules');
  {
    const promptExcellent = KidbusterCore.buildBeidaSystemPrompt({ rating: 'excellent' });
    check('has LESSON EVIDENCE RULE section', promptExcellent.includes('LESSON EVIDENCE RULE (IMMUTABLE)'));
    check('has SAFE INFERENCE PRINCIPLE section', promptExcellent.includes('SAFE INFERENCE PRINCIPLE'));
    check('has STUDENT PERFORMANCE RATING section using BetaKid\'s real field names', promptExcellent.includes('STUDENT PERFORMANCE RATING (IMMUTABLE)') && promptExcellent.includes('"Excellent" or "try harder please."'));
    check('requires the exact greeting format', promptExcellent.includes('"Hi [Student], teacher [Teacher] here!"'));
    check('requires vocabulary to be named, not bulleted', promptExcellent.includes('never as a bulleted or numbered list'));
    check('requires third person for General and Detailed Performance', promptExcellent.includes('Written in the third person about the student'));
    check('states Learning Content\'s real platform length bounds (200-2000)', promptExcellent.includes('200-2000 characters'));
    check('states Performance\'s real platform length bounds (200-4000)', promptExcellent.includes('200-4000 characters'));
    check('output format specifies the two exact header lines in order', promptExcellent.includes('LEARNING CONTENT:') && promptExcellent.includes('GENERAL AND DETAILED PERFORMANCE:'));

    check('runtime tail states "Excellent" for rating=excellent', promptExcellent.includes('Selected rating: Excellent'));
    check('runtime tail for "excellent" permits an all-positive Performance field', promptExcellent.includes('may be entirely positive if nothing specific to work on is actually supported'));

    const promptTryHarder = KidbusterCore.buildBeidaSystemPrompt({ rating: 'try_harder' });
    check('runtime tail states "try harder please" for rating=try_harder', promptTryHarder.includes('Selected rating: try harder please'));
    check('runtime tail for "try_harder" REQUIRES an area needing practice', promptTryHarder.includes('MUST include one clear, kind, specific area needing practice'));

    check('defaults to "excellent" tier when no rating given at all', KidbusterCore.buildBeidaSystemPrompt({}).includes('Selected rating: Excellent'));
  }

  console.log('\n3) splitBeidaOutput: correctly separates and strips the two header markers');
  function makeRaw(learningContent, performance){
    return `LEARNING CONTENT:\n${learningContent}\n\nGENERAL AND DETAILED PERFORMANCE:\n${performance}`;
  }
  {
    const raw = makeRaw('Hi Boyan, teacher Layne here! Some vocab talk.', 'Boyan did great. Fantastic work today, Boyan!');
    const sections = KidbusterCore.splitBeidaOutput(raw);
    check('returns a non-null object when both headers present, in order', sections !== null);
    check('learningContent has the header stripped', !sections.learningContent.includes('LEARNING CONTENT'));
    check('performance has the header stripped', !sections.performance.includes('GENERAL AND DETAILED PERFORMANCE'));
    check('learningContent content is correct', sections.learningContent === 'Hi Boyan, teacher Layne here! Some vocab talk.');
    check('performance content is correct', sections.performance === 'Boyan did great. Fantastic work today, Boyan!');

    check('missing both headers -> returns null', KidbusterCore.splitBeidaOutput('just plain text') === null);
    check('headers in wrong order -> returns null', KidbusterCore.splitBeidaOutput('GENERAL AND DETAILED PERFORMANCE:\nx\n\nLEARNING CONTENT:\ny') === null);
    check('only one header present -> returns null', KidbusterCore.splitBeidaOutput('LEARNING CONTENT:\nonly this one') === null);
  }

  console.log('\n4) analyzeBeidaOutput: the real BetaKid example (adapted) passes with zero warnings');
  {
    const realExample = makeRaw(
      'Hi Boyan, teacher Layne here! 🤙 Thank you for joining today\'s lesson and continuing "Master of Disguise" with great focus and participation. We learned more about the incredible ways animals use camouflage and mimicry to survive while practicing vocabulary such as chromatophores, pigment, pattern, texture, mimic, reflect light, chameleon, cuttlefish, leaf-tailed gecko, arctic fox, and seahorse.',
      'Boyan showed outstanding curiosity throughout today\'s lesson and demonstrated a strong understanding of the scientific concepts presented in the reading. He followed the text carefully, participated actively in discussions, and confidently used the new vocabulary to explain how different animals change their appearance to protect themselves or catch prey. He made thoughtful comparisons between different species and showed excellent reasoning when discussing how these amazing adaptations help animals survive in the wild. His enthusiasm, careful participation, and consistent effort continue to help him make exceptional progress in English.\n\nFantastic work today, Boyan! 🦎🐍🌿'
    );
    const warnings = KidbusterCore.analyzeBeidaOutput(realExample, 'excellent', 'Layne');
    check('the real (adapted) BetaKid example -> zero warnings', warnings.length === 0);
    if(warnings.length){ console.log('    (unexpected warnings:', warnings, ')'); }
  }

  console.log('\n5) analyzeBeidaOutput: structural failures');
  {
    const missingHeaders = KidbusterCore.analyzeBeidaOutput('no structure here at all', 'excellent', 'Layne');
    check('missing headers -> flagged, and nothing else attempted', missingHeaders.length === 1 && missingHeaders[0].includes('Could not find both'));

    const wrongOrder = KidbusterCore.analyzeBeidaOutput(
      'GENERAL AND DETAILED PERFORMANCE:\nx\n\nLEARNING CONTENT:\ny', 'excellent', 'Layne'
    );
    check('headers in wrong order -> flagged the same way', wrongOrder.some(w => w.includes('Could not find both')));
  }

  console.log('\n6) analyzeBeidaOutput: greeting format is required and teacher-specific');
  {
    const goodGreeting = makeRaw('Hi Boyan, teacher Layne here! ' + 'x'.repeat(200), 'y'.repeat(250));
    check('correct greeting, correct teacher -> not flagged for greeting', !KidbusterCore.analyzeBeidaOutput(goodGreeting, 'excellent', 'Layne').some(w => w.includes('does not open with')));

    const wrongGreetingStyle = makeRaw('Hey Boyan, it\'s Layne! ' + 'x'.repeat(200), 'y'.repeat(250));
    check('wrong greeting phrasing -> flagged', KidbusterCore.analyzeBeidaOutput(wrongGreetingStyle, 'excellent', 'Layne').some(w => w.includes('does not open with')));

    const wrongTeacherName = makeRaw('Hi Boyan, teacher Nina here! ' + 'x'.repeat(200), 'y'.repeat(250));
    check('correct format but wrong teacher name -> flagged (validated against the actual Teacher field)', KidbusterCore.analyzeBeidaOutput(wrongTeacherName, 'excellent', 'Layne').some(w => w.includes('does not open with')));
    check('...but passes when validated against the matching teacher name', !KidbusterCore.analyzeBeidaOutput(wrongTeacherName, 'excellent', 'Nina').some(w => w.includes('does not open with')));
  }

  console.log('\n7) analyzeBeidaOutput: per-field length bounds match BetaKid\'s real limits exactly');
  {
    const goodGreeting = (n) => 'Hi Boyan, teacher Layne here! ' + 'x'.repeat(Math.max(0, n - 'Hi Boyan, teacher Layne here! '.length));

    check('Learning Content at 199 chars -> flagged (under 200)', KidbusterCore.analyzeBeidaOutput(makeRaw(goodGreeting(199), 'y'.repeat(250)), 'excellent', 'Layne').some(w => w.includes('Learning Content is') && w.includes('200 and 2000')));
    check('Learning Content at 200 chars -> NOT flagged for length', !KidbusterCore.analyzeBeidaOutput(makeRaw(goodGreeting(200), 'y'.repeat(250)), 'excellent', 'Layne').some(w => w.includes('Learning Content is')));
    check('Learning Content at 2000 chars -> NOT flagged for length', !KidbusterCore.analyzeBeidaOutput(makeRaw(goodGreeting(2000), 'y'.repeat(250)), 'excellent', 'Layne').some(w => w.includes('Learning Content is')));
    check('Learning Content at 2001 chars -> flagged (over 2000)', KidbusterCore.analyzeBeidaOutput(makeRaw(goodGreeting(2001), 'y'.repeat(250)), 'excellent', 'Layne').some(w => w.includes('Learning Content is') && w.includes('200 and 2000')));

    check('Performance at 199 chars -> flagged (under 200)', KidbusterCore.analyzeBeidaOutput(makeRaw(goodGreeting(250), 'y'.repeat(199)), 'excellent', 'Layne').some(w => w.includes('General and Detailed Performance is') && w.includes('200 and 4000')));
    check('Performance at 4000 chars -> NOT flagged for length', !KidbusterCore.analyzeBeidaOutput(makeRaw(goodGreeting(250), 'y'.repeat(4000)), 'excellent', 'Layne').some(w => w.includes('General and Detailed Performance is')));
    check('Performance at 4001 chars -> flagged (over 4000)', KidbusterCore.analyzeBeidaOutput(makeRaw(goodGreeting(250), 'y'.repeat(4001)), 'excellent', 'Layne').some(w => w.includes('General and Detailed Performance is') && w.includes('200 and 4000')));
  }

  console.log('\n8) analyzeBeidaOutput: no bullet points allowed in either field, and shared forbidden-formatting checks apply');
  {
    const goodGreeting = 'Hi Boyan, teacher Layne here! ' + 'x'.repeat(200);

    const bulletInLearning = makeRaw('Hi Boyan, teacher Layne here!\n- word one\n- word two\n' + 'x'.repeat(200), 'y'.repeat(250));
    check('bullet points in Learning Content -> flagged', KidbusterCore.analyzeBeidaOutput(bulletInLearning, 'excellent', 'Layne').some(w => w.includes('Learning Content appears to contain a bullet')));

    const bulletInPerformance = makeRaw(goodGreeting, '- strength one\n- strength two\n' + 'y'.repeat(250));
    check('bullet points in Performance -> flagged', KidbusterCore.analyzeBeidaOutput(bulletInPerformance, 'excellent', 'Layne').some(w => w.includes('General and Detailed Performance appears to contain a bullet')));

    const withBold = makeRaw(goodGreeting, '**' + 'y'.repeat(250) + '**');
    check('markdown bold anywhere -> flagged via the shared forbidden-formatting check', KidbusterCore.analyzeBeidaOutput(withBold, 'excellent', 'Layne').some(w => w.toLowerCase().includes('bold')));

    const clean = makeRaw(goodGreeting, 'y'.repeat(250));
    check('clean report -> zero warnings', KidbusterCore.analyzeBeidaOutput(clean, 'excellent', 'Layne').length === 0);
  }

  console.log('\n9) PROTOCOLS.BEIDA.analyze wraps analyzeBeidaOutput correctly through the registry');
  {
    const goodGreeting = 'Hi Boyan, teacher Layne here! ' + 'x'.repeat(200);
    const clean = makeRaw(goodGreeting, 'y'.repeat(250));
    const viaRegistry = KidbusterCore.PROTOCOLS.BEIDA.analyze(clean, 'excellent', 'Layne');
    const direct = KidbusterCore.analyzeBeidaOutput(clean, 'excellent', 'Layne');
    check('PROTOCOLS.BEIDA.analyze gives the same result as calling analyzeBeidaOutput directly', JSON.stringify(viaRegistry) === JSON.stringify(direct));
  }

  console.log('\n10) buildUserMessage: Beida gets Lesson Evidence framing and its own rating label, not a /5 scale');
  {
    const msgExcellent = KidbusterCore.buildUserMessage({ studentName: 'Boyan', notes: 'x', rating: 'excellent', protocol: 'BEIDA' });
    check('uses "Selected rating: Excellent", not "Rating: excellent/5"', msgExcellent.includes('Selected rating: Excellent') && !msgExcellent.includes('/5'));
    check('uses Lesson evidence framing, like Blitz', msgExcellent.includes('Lesson evidence ('));

    const msgTryHarder = KidbusterCore.buildUserMessage({ studentName: 'Boyan', notes: 'x', rating: 'try_harder', protocol: 'BEIDA' });
    check('uses "Selected rating: try harder please" for the other tier', msgTryHarder.includes('Selected rating: try harder please'));

    const msgWithRemarks = KidbusterCore.buildUserMessage({ studentName: 'Boyan', notes: 'x', remarks: 'Was distracted today.', rating: 'excellent', protocol: 'BEIDA' });
    check('Special remarks use the plain (non-bridged) phrasing, matching Beida\'s own prompt wording', msgWithRemarks.includes('Special remarks to incorporate') && !msgWithRemarks.includes('Teacher Notes'));
  }

  console.log('\n11) Regression: the model must actually be told the real teacher name — a real generation once hallucinated one entirely');
  {
    // Beida's greeting is a literal bracket placeholder ("teacher [Teacher]
    // here!") in its own prompt text, unlike MA/Sugarcoat/OF, which hardcode
    // the literal word "Layne" and rely on applyTeacherIdentity to swap it
    // for the real name. Beida's prompt never contains "Layne" at all, so
    // without an explicit Fact in the user message, the model has no real
    // information to fill that placeholder with — confirmed by an actual
    // generation that invented a teacher name having nothing to do with
    // what was in the Teacher field.
    const msg = KidbusterCore.buildUserMessage({ studentName: 'Momo', teacherName: 'Layne', notes: 'x', rating: 'excellent', protocol: 'BEIDA' });
    check('user message explicitly states the real teacher name as a Fact', msg.includes('Teacher: Layne'));
    check('explicitly instructs against inventing a different name', msg.includes('never invent or guess a different one'));

    const msgOtherTeacher = KidbusterCore.buildUserMessage({ studentName: 'Momo', teacherName: 'Nina', notes: 'x', rating: 'excellent', protocol: 'BEIDA' });
    check('works correctly for any teacher name, not just the default', msgOtherTeacher.includes('Teacher: Nina'));

    const msgNoTeacherGiven = KidbusterCore.buildUserMessage({ studentName: 'Momo', notes: 'x', rating: 'excellent', protocol: 'BEIDA' });
    check('falls back to Layne when no teacher name is given at all, matching every other protocol\'s default', msgNoTeacherGiven.includes('Teacher: Layne'));

    check('this Fact is Beida-specific — MA\'s user message has no such line (it gets the name via prompt substitution instead)', !KidbusterCore.buildUserMessage({ studentName: 'Momo', teacherName: 'Layne', notes: 'x', rating: '4', protocol: 'MA' }).includes('Teacher: Layne'));

    // The prompt's own instruction was strengthened too, not just the
    // user message — confirm both landed.
    const prompt = KidbusterCore.buildBeidaSystemPrompt({ rating: 'excellent' });
    check('prompt explicitly says never invent/guess a name for either the student or teacher', prompt.includes('Never invent, guess, or default to any other name for either'));
  }

  console.log('\n12) Sissy (and Faye) get their hidden default sign-off emoji on Beida too, via the same Teacher Fact mechanism');
  {
    const msgSissy = KidbusterCore.buildUserMessage({ studentName: 'Momo', teacherName: 'Sissy', notes: 'x', rating: 'excellent', protocol: 'BEIDA' });
    check('Sissy\'s user message instructs the model to include 🌻 right after her name', msgSissy.includes('include exactly this emoji: 🌻') && msgSissy.includes('teacher Sissy 🌻 here!'));

    const msgFaye = KidbusterCore.buildUserMessage({ studentName: 'Momo', teacherName: 'Faye', notes: 'x', rating: 'excellent', protocol: 'BEIDA' });
    check('Faye gets the same treatment, with her own 🧚', msgFaye.includes('include exactly this emoji: 🧚'));

    const msgNina = KidbusterCore.buildUserMessage({ studentName: 'Momo', teacherName: 'Nina', notes: 'x', rating: 'excellent', protocol: 'BEIDA' });
    check('a teacher with no hidden default (e.g. Nina) gets no such extra instruction line', !msgNina.includes('include exactly this emoji'));

    function makeReport(learningContent, performance){
      return `LEARNING CONTENT:\n${learningContent}\n\nGENERAL AND DETAILED PERFORMANCE:\n${performance}`;
    }
    const sissyWithSunflower = makeReport('Hi Momo, teacher Sissy 🌻 here! ' + 'x'.repeat(200), 'y'.repeat(250));
    check('validator: Sissy WITH 🌻 in the greeting -> not flagged', !KidbusterCore.analyzeBeidaOutput(sissyWithSunflower, 'excellent', 'Sissy').some(w => w.includes('does not open')));

    const sissyMissingSunflower = makeReport('Hi Momo, teacher Sissy here! ' + 'x'.repeat(200), 'y'.repeat(250));
    check('validator: Sissy WITHOUT 🌻 in the greeting -> flagged', KidbusterCore.analyzeBeidaOutput(sissyMissingSunflower, 'excellent', 'Sissy').some(w => w.includes('does not open')));

    const ninaNoEmojiNeeded = makeReport('Hi Momo, teacher Nina here! ' + 'x'.repeat(200), 'y'.repeat(250));
    check('validator: a teacher with no hidden default (Nina) is NOT required to have any emoji', !KidbusterCore.analyzeBeidaOutput(ninaNoEmojiNeeded, 'excellent', 'Nina').some(w => w.includes('does not open')));
  }

  return getFailures();
};

if(require.main === module){
  const failures = module.exports();
  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}
