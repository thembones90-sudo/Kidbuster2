'use strict';
const { extractKidbusterCore } = require('./helpers/extract-core.cjs');
const { createChecker } = require('./helpers/assert.cjs');

/**
 * Covers OF's own foundational validator checks — section presence/order,
 * per-section character limits, the 180-300 word range, the qualitative-
 * tier-leak guard, and its generic "Cheers," sign-off. None of this was covered by any
 * other test file, despite OF being one of the two original protocols.
 */
module.exports = function run(){
  const KidbusterCore = extractKidbusterCore();
  const { check, getFailures } = createChecker();

  console.log('\n=== test-of-protocol.cjs ===');

  function words(n, sentence){
    // Repeats a real sentence rather than a single filler word, since OF's
    // per-section extraction looks for actual section headers in context —
    // a wall of one repeated word is still valid prose for these purposes,
    // but real sentences make failures easier to read if something's off.
    const unit = sentence || 'The student engaged well with the lesson today.';
    const words = [];
    while(words.join(' ').split(/\s+/).filter(Boolean).length < n){
      words.push(unit);
    }
    return words.join(' ');
  }

  function baseReport({ strengthsWords = 90, areasWords = 90, suggestionsWords = 60, order = ['Strengths', 'Areas for Improvement', 'Learning Suggestions'], signoff = 'Cheers,\nTeacher Layne' } = {}){
    const sections = {
      'Strengths': 'Strengths:\n' + words(strengthsWords, 'The student showed strong listening skills and stayed engaged.'),
      'Areas for Improvement': 'Areas for Improvement:\n' + words(areasWords, 'Pronunciation of longer words could use more practice.'),
      'Learning Suggestions': 'Learning Suggestions:\n' + words(suggestionsWords, 'Continue practicing vocabulary at home with simple flashcards.')
    };
    const body = order.map(name => sections[name]).join('\n\n');
    return body + '\n\n' + signoff;
  }

  console.log('\n1) A genuinely valid OF report produces zero warnings');
  {
    const report = baseReport();
    const warnings = KidbusterCore.analyzeOFOutput(report, 'Medium', 'Layne');
    check('valid report -> zero warnings', warnings.length === 0);
    if(warnings.length){ console.log('    (unexpected warnings:', warnings, ')'); }
  }

  console.log('\n1b) OF prompt uses the generic Cheers sign-off, not the old Prepared by closing');
  {
    const prompt = KidbusterCore.applyTeacherIdentity(
      KidbusterCore.buildOFSystemPrompt({ rating: 'Medium' }),
      'Nina'
    );
    check('prompt contains "Cheers, / Teacher Nina"', prompt.includes('Cheers,\nTeacher Nina'));
    check('prompt no longer contains "Prepared by"', !prompt.includes('Prepared by'));

    const fayePrompt = KidbusterCore.applyProtocolSignoffEmoji(
      KidbusterCore.applyTeacherIdentity(KidbusterCore.buildOFSystemPrompt({ rating: 'Medium' }), 'Faye'),
      'Faye',
      'OF'
    );
    check('OF prompt for Faye contains "Cheers, / Teacher Faye 🧚"', fayePrompt.includes('Cheers,\nTeacher Faye 🧚'));
  }

  console.log('\n2) All 3 required sections must be present');
  {
    const missingAreas = baseReport({ order: ['Strengths', 'Learning Suggestions'] });
    const warn = KidbusterCore.analyzeOFOutput(missingAreas, 'Medium', 'Layne');
    check('missing "Areas for Improvement" -> flagged by name', warn.some(w => w.includes('Missing required section') && w.includes('Areas for Improvement')));
  }

  console.log('\n3) Sections must appear in order: Strengths, Areas for Improvement, Learning Suggestions');
  {
    const wrongOrder = baseReport({ order: ['Learning Suggestions', 'Strengths', 'Areas for Improvement'] });
    const warn = KidbusterCore.analyzeOFOutput(wrongOrder, 'Medium', 'Layne');
    check('sections out of order -> flagged', warn.some(w => w.includes('out of order')));

    const rightOrder = KidbusterCore.analyzeOFOutput(baseReport(), 'Medium', 'Layne');
    check('sections in correct order -> not flagged for order', !rightOrder.some(w => w.includes('out of order')));
  }

  console.log('\n4) Strengths / Areas for Improvement each have an independent 1300-character limit');
  {
    // ~90 words of the given sentences comfortably clears 1300 characters
    // once repeated enough — use a big word count to force it over.
    const longStrengths = baseReport({ strengthsWords: 260 });
    const warn = KidbusterCore.analyzeOFOutput(longStrengths, 'Medium', 'Layne');
    check('Strengths over 1300 chars -> flagged, Areas untouched', warn.some(w => w.includes('Strengths section is')) && !warn.some(w => w.includes('Areas for Improvement section is')));

    const longAreas = baseReport({ areasWords: 260 });
    const warnAreas = KidbusterCore.analyzeOFOutput(longAreas, 'Medium', 'Layne');
    check('Areas for Improvement over 1300 chars -> flagged, Strengths untouched', warnAreas.some(w => w.includes('Areas for Improvement section is')) && !warnAreas.some(w => w.includes('Strengths section is')));

    // Learning Suggestions has no character-limit check at all (by design —
    // only Strengths/Areas are separate platform fields with that limit).
    const longSuggestions = baseReport({ suggestionsWords: 400 });
    const warnSuggestions = KidbusterCore.analyzeOFOutput(longSuggestions, 'Medium', 'Layne');
    check('Learning Suggestions has no character-limit check', !warnSuggestions.some(w => w.includes('Learning Suggestions section is')));
  }

  console.log('\n5) Word count target: 180-300 words total across all three sections');
  {
    const short = baseReport({ strengthsWords: 20, areasWords: 20, suggestionsWords: 20 });
    const warnShort = KidbusterCore.analyzeOFOutput(short, 'Medium', 'Layne');
    check('well under 180 words -> flagged as shorter than range', warnShort.some(w => w.includes('shorter than the intended 180-300')));

    const long = baseReport({ strengthsWords: 150, areasWords: 150, suggestionsWords: 150 });
    const warnLong = KidbusterCore.analyzeOFOutput(long, 'Medium', 'Layne');
    check('well over 300 words -> flagged as longer than range', warnLong.some(w => w.includes('longer than the intended 180-300')));

    const justRight = KidbusterCore.analyzeOFOutput(baseReport({ strengthsWords: 90, areasWords: 90, suggestionsWords: 60 }), 'Medium', 'Layne');
    check('within 180-300 words -> not flagged for word count', !justRight.some(w => w.includes('180-300')));
  }

  console.log('\n6) Internal qualitative tier labels must never leak into the output');
  {
    const leaked = baseReport().replace('Strengths:', 'Strengths: (Low/Medium)');
    const warn = KidbusterCore.analyzeOFOutput(leaked, 'Low/Medium', 'Layne');
    check('"Low/Medium" leaking into text -> flagged', warn.some(w => w.includes('leaked')));

    const leakedOther = baseReport().replace('Strengths:', 'Strengths: (Medium/High)');
    const warnOther = KidbusterCore.analyzeOFOutput(leakedOther, 'Medium/High', 'Layne');
    check('"Medium/High" leaking into text -> flagged', warnOther.some(w => w.includes('leaked')));

    // Plain "high"/"low"/"medium" as ordinary English words must NOT be
    // flagged — only the two compound, slash-joined tier names are a real
    // leakage signal (see the comment in analyzeOFOutput itself).
    const ordinaryWord = baseReport({ suggestionsWords: 10 }) + ' The student showed high confidence and low anxiety today.';
    const warnOrdinary = KidbusterCore.analyzeOFOutput(ordinaryWord, 'Medium', 'Layne');
    check('ordinary words "high"/"low" in prose -> NOT flagged (not a real leak)', !warnOrdinary.some(w => w.includes('leaked')));
  }

  console.log('\n7) Sign-off must exactly match "Cheers, / Teacher {name}" (no emoji)');
  {
    const wrongPhrase = baseReport({ signoff: 'Sincerely,\nTeacher Layne' });
    const warn = KidbusterCore.analyzeOFOutput(wrongPhrase, 'Medium', 'Layne');
    check('wrong closing phrase -> flagged', warn.some(w => w.includes('sign-off')));

    const withEmoji = baseReport({ signoff: 'Cheers,\nTeacher Layne *' });
    const warnEmoji = KidbusterCore.analyzeOFOutput(withEmoji, 'Medium', 'Layne');
    check('OF sign-off with anything appended -> flagged', warnEmoji.some(w => w.includes('sign-off')));

    const correct = KidbusterCore.analyzeOFOutput(baseReport(), 'Medium', 'Layne');
    check('correct "Cheers" sign-off, no emoji -> not flagged', !correct.some(w => w.includes('sign-off')));

    const otherTeacher = baseReport({ signoff: 'Cheers,\nTeacher Nina' });
    const correctOtherTeacher = KidbusterCore.analyzeOFOutput(otherTeacher, 'Medium', 'Nina');
    check('correct "Cheers" sign-off uses the selected teacher name', !correctOtherTeacher.some(w => w.includes('sign-off')));

    const fayeTeacher = baseReport({ signoff: 'Cheers,\nTeacher Faye 🧚' });
    const correctFayeTeacher = KidbusterCore.analyzeOFOutput(fayeTeacher, 'Medium', 'Faye');
    check('Faye OF sign-off requires hidden 🧚 and passes when present', !correctFayeTeacher.some(w => w.includes('sign-off')));

    const fayeMissingFairy = baseReport({ signoff: 'Cheers,\nTeacher Faye' });
    const warnFayeMissingFairy = KidbusterCore.analyzeOFOutput(fayeMissingFairy, 'Medium', 'Faye');
    check('Faye OF sign-off missing 🧚 -> flagged', warnFayeMissingFairy.some(w => w.includes('sign-off')));
  }

  console.log('\n8) Forbidden formatting: no bold, no italics (shared across every protocol)');
  {
    const withBold = baseReport().replace('Strengths:', '**Strengths:**');
    const warn = KidbusterCore.analyzeOFOutput(withBold, 'Medium', 'Layne');
    check('markdown bold -> flagged', warn.some(w => w.toLowerCase().includes('bold')));
  }

  console.log('\n9) Student pronoun (Boy/Girl toggle): user message includes the correct Fact, only for OF');
  {
    const boyMsg = KidbusterCore.buildUserMessage({ studentName: 'Sam', notes: 'x', rating: '4', protocol: 'OF', studentGender: 'boy' });
    check('OF + boy -> user message says "use he/him/his"', boyMsg.includes('use he/him/his'));

    const girlMsg = KidbusterCore.buildUserMessage({ studentName: 'Sam', notes: 'x', rating: '4', protocol: 'OF', studentGender: 'girl' });
    check('OF + girl -> user message says "use she/her/her"', girlMsg.includes('use she/her/her'));

    const unspecifiedMsg = KidbusterCore.buildUserMessage({ studentName: 'Sam', notes: 'x', rating: '4', protocol: 'OF', studentGender: '' });
    check('OF + unspecified -> defaults to they/them rather than guessing', unspecifiedMsg.includes('default to "they/them"'));

    const maMsg = KidbusterCore.buildUserMessage({ studentName: 'Sam', notes: 'x', rating: '4', protocol: 'MA', studentGender: 'boy' });
    check('MA (not OF) -> no "Student pronoun" line at all, even if studentGender was somehow set', !maMsg.includes('Student pronoun'));
  }

  console.log('\n10) Validator flags a pronoun mismatch, only when it actually occurs');
  {
    const withWrongPronounForBoy = baseReport().replace('The student showed strong listening skills', 'She showed strong listening skills');
    const warnBoy = KidbusterCore.analyzeOFOutput(withWrongPronounForBoy, 'Medium', 'Layne', 'boy');
    check('Boy specified but "She" used in text -> flagged', warnBoy.some(w => w.includes('despite the student pronoun being specified as Boy')));

    const withWrongPronounForGirl = baseReport().replace('The student showed strong listening skills', 'He showed strong listening skills');
    const warnGirl = KidbusterCore.analyzeOFOutput(withWrongPronounForGirl, 'Medium', 'Layne', 'girl');
    check('Girl specified but "He" used in text -> flagged', warnGirl.some(w => w.includes('despite the student pronoun being specified as Girl')));

    const consistentBoy = KidbusterCore.analyzeOFOutput(baseReport(), 'Medium', 'Layne', 'boy');
    check('Boy specified, no opposite pronoun present -> not flagged', !consistentBoy.some(w => w.includes('pronoun being specified')));

    const noGenderGiven = KidbusterCore.analyzeOFOutput(withWrongPronounForBoy, 'Medium', 'Layne', '');
    check('No gender specified at all -> never flagged, regardless of pronouns used', !noGenderGiven.some(w => w.includes('pronoun being specified')));
  }

  console.log('\n11) PROTOCOLS.OF.analyze correctly threads studentGender through as its 5th positional arg');
  {
    const withWrongPronoun = baseReport().replace('The student showed strong listening skills', 'She showed strong listening skills');
    const viaProtocol = KidbusterCore.PROTOCOLS.OF.analyze(withWrongPronoun, 'Medium', 'Layne', 'long', 'boy');
    check('PROTOCOLS.OF.analyze(text, lvl, teacher, lengthFormat, gender) -> gender reaches the validator correctly', viaProtocol.some(w => w.includes('pronoun being specified as Boy')));
  }

  return getFailures();
};

if(require.main === module){
  const failures = module.exports();
  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}
