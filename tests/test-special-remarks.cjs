'use strict';
const { extractKidbusterCore } = require('./helpers/extract-core.cjs');
const { createChecker } = require('./helpers/assert.cjs');

module.exports = function run(){
  const KidbusterCore = extractKidbusterCore();
  const { check, getFailures } = createChecker();

  console.log('\n=== test-special-remarks.cjs ===');

  console.log('\n1) MA prompt: strengthened Teacher Notes priority + behavioral-incident guidance');
  {
    const prompt = KidbusterCore.buildMASystemPrompt({ rating: '2', lengthFormat: 'long' });
    check('says "high-priority factual input"', prompt.includes('high-priority factual input'));
    check('explicitly mentions behavioral concern / misbehaving', prompt.includes('the student misbehaving'));
    check('points to Parent Note as the usual home for it', prompt.includes('most often within the Parent Note section'));
    check('validation checklist reinforces it too', prompt.includes('Teacher Notes incorporated — including any behavioral or disciplinary concern'));
  }

  console.log('\n2) Sugarcoat prompt: same strengthened guidance, in its own voice');
  {
    const prompt = KidbusterCore.buildSweetSystemPrompt({ rating: '2', lengthFormat: 'long' });
    check('says "crucial, high-priority part"', prompt.includes('crucial, high-priority part'));
    check('explicitly mentions behavioral concern / misbehaving', prompt.includes('the student misbehaving'));
    check('points to Parent Note as the usual home for it', prompt.includes('most often within the Parent Note section'));
  }

  console.log('\n3) OF prompt: same strengthened guidance, pointed at Areas for Improvement instead of Parent Note');
  {
    const prompt = KidbusterCore.buildOFSystemPrompt({ rating: 'Low' });
    check('says "high-priority factual input"', prompt.includes('high-priority factual input'));
    check('explicitly mentions behavioral concern / misbehaving', prompt.includes('the student misbehaving'));
    check('points to Areas for Improvement, not Parent Note (OF has no Parent Note)', prompt.includes('most often within Areas for Improvement') && !prompt.includes('Parent Note'));
    check('validation checklist reinforces it too', prompt.includes('Teacher Notes incorporated — including any behavioral or disciplinary concern'));
  }

  console.log('\n4) Blitz prompt: new Special Remarks handling (previously had none at all)');
  {
    const prompt = KidbusterCore.buildBlitzSystemPrompt({ forcedModelKey: 'standard' });
    check('mentions "Special remarks" as high-priority', prompt.includes('"Special remarks" are provided') && prompt.includes('high-priority factual input'));
    check('explicitly mentions behavioral concern / misbehaving', prompt.includes('the student misbehaving'));
    check('ties it to the "one area needing practice" line', prompt.includes('one area that still needs practice'));
    check('validation checklist has a matching line', prompt.includes('Any "Special remarks" provided'));
  }

  console.log('\n5) buildUserMessage bridges "Special remarks" (UI/user-message term) with "Teacher Notes" (MA/MS/OF prompt term)');
  {
    const maMsg = KidbusterCore.buildUserMessage({ studentName:'Sam', notes:'x', remarks:'Was disruptive and refused to sit down.', rating:'2', protocol:'MA' });
    check('MA user message bridges to "Teacher Notes"', maMsg.includes('these are the "Teacher Notes" referenced'));
    check('MA user message still contains the actual remark text', maMsg.includes('Was disruptive and refused to sit down.'));

    const msMsg = KidbusterCore.buildUserMessage({ studentName:'Sam', notes:'x', remarks:'Was disruptive.', rating:'2', protocol:'MS' });
    check('Sugarcoat (MS) user message also bridges to "Teacher Notes"', msMsg.includes('these are the "Teacher Notes" referenced'));

    const ofMsg = KidbusterCore.buildUserMessage({ studentName:'Sam', notes:'x', remarks:'Was disruptive.', rating:'2', protocol:'OF' });
    check('OF user message also bridges to "Teacher Notes"', ofMsg.includes('these are the "Teacher Notes" referenced'));

    const blitzMsg = KidbusterCore.buildUserMessage({ studentName:'Sam', notes:'x', remarks:'Was disruptive.', rating:'2', protocol:'BLITZ' });
    check('Blitz user message does NOT need the bridge (its own prompt already says "Special remarks")', blitzMsg.includes('Special remarks to incorporate') && !blitzMsg.includes('Teacher Notes'));

    const noRemarksMsg = KidbusterCore.buildUserMessage({ studentName:'Sam', notes:'x', remarks:'', rating:'2', protocol:'MA' });
    check('no remarks provided -> no Special remarks line at all', !noRemarksMsg.includes('Special remarks'));
  }

  return getFailures();
};

if(require.main === module){
  const failures = module.exports();
  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}
