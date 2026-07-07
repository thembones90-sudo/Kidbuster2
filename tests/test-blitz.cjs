'use strict';
const { extractKidbusterCore } = require('./helpers/extract-core.cjs');
const { createChecker } = require('./helpers/assert.cjs');

module.exports = function run(){
  const KidbusterCore = extractKidbusterCore();
  const { check, getFailures } = createChecker();

  console.log('\n=== test-blitz.cjs ===');

  console.log('\n1) Blitz is registered correctly in PROTOCOLS');
  check('PROTOCOLS.BLITZ exists', !!KidbusterCore.PROTOCOLS.BLITZ);
  check('PROTOCOLS.BLITZ.label is "Blitz"', KidbusterCore.PROTOCOLS.BLITZ.label === 'Blitz');
  check('PROTOCOLS.BLITZ.models has 10 entries', KidbusterCore.PROTOCOLS.BLITZ.models.length === 10);
  check('BLITZ_MODEL_POOL exported directly has 10 entries', KidbusterCore.BLITZ_MODEL_POOL.length === 10);

  console.log('\n2) Exactly one model is selected per generation, never blended');
  {
    const seenKeys = new Set();
    for(let i = 0; i < 60; i++){
      const prompt = KidbusterCore.buildBlitzSystemPrompt({});
      // Count how many of the 10 models' example text appears verbatim in the prompt.
      const matches = KidbusterCore.BLITZ_MODEL_POOL.filter(m => prompt.includes(m.text));
      if(matches.length === 1) seenKeys.add(matches[0].key);
      check('Call ' + i + ': exactly one model\'s text present (found ' + matches.length + ')', matches.length === 1);
      if(matches.length !== 1) break; // stop spamming failures if something is fundamentally wrong
    }
    check('Randomness actually varies across calls (saw >1 distinct model in 60 calls)', seenKeys.size > 1);
    console.log('  (distinct models seen across 60 calls: ' + seenKeys.size + '/10)');
  }

  console.log('\n3) forcedModelKey override works (test-only path)');
  KidbusterCore.BLITZ_MODEL_POOL.forEach(m => {
    const prompt = KidbusterCore.buildBlitzSystemPrompt({ forcedModelKey: m.key });
    check('forcedModelKey=' + m.key + ' -> prompt contains that model\'s text', prompt.includes(m.text));
    check('forcedModelKey=' + m.key + ' -> prompt contains its label', prompt.includes('Model: ' + m.label));
    const otherModelsPresent = KidbusterCore.BLITZ_MODEL_POOL.filter(other => other.key !== m.key && prompt.includes(other.text));
    check('forcedModelKey=' + m.key + ' -> no other model\'s text present', otherModelsPresent.length === 0);
  });

  console.log('\n4) Prompt contains no leftover tokens and no rating/length-tier concepts');
  {
    const prompt = KidbusterCore.buildBlitzSystemPrompt({ forcedModelKey: 'standard' });
    check('no leftover __BLITZ_MODEL_LABEL__ token', !prompt.includes('__BLITZ_MODEL_LABEL__'));
    check('no leftover __BLITZ_MODEL_TEXT__ token', !prompt.includes('__BLITZ_MODEL_TEXT__'));
    check('mentions the 70-120 word target', prompt.includes('70-120 words'));
    check('mentions the 150-word hard limit', prompt.includes('150 words'));
  }

  console.log('\n5) buildUserMessage includes the Rating line for every protocol, including Blitz (which now has ratings again)');
  {
    const blitzMsg = KidbusterCore.buildUserMessage({ studentName:'Sam', notes:'practiced past tense', rating:'4', protocol:'BLITZ' });
    check('Blitz user message now has a "Rating:" line', blitzMsg.includes('Rating: 4/5'));
    check('Blitz user message still has Student/notes', blitzMsg.includes('Student: Sam') && blitzMsg.includes('practiced past tense'));

    const maMsg = KidbusterCore.buildUserMessage({ studentName:'Sam', notes:'practiced past tense', rating:'4', protocol:'MA' });
    check('MA user message still has "Rating:" line', maMsg.includes('Rating: 4/5'));
  }

  console.log('\n6) Validator: word count target/ceiling');
  function words(n){ return new Array(n).fill('word').join(' '); }
  {
    const tooLong = words(160);
    const warnTooLong = KidbusterCore.analyzeBlitzOutput(tooLong);
    check('160 words -> CRITICAL over 150-word hard limit', warnTooLong.some(w => w.includes('CRITICAL') && w.includes('150')));

    const overTarget = words(135);
    const warnOverTarget = KidbusterCore.analyzeBlitzOutput(overTarget);
    check('135 words -> soft warning over 70-120 target, not CRITICAL', warnOverTarget.some(w => w.includes('70-120')) && !warnOverTarget.some(w => w.includes('CRITICAL')));

    const tooShort = words(40);
    const warnTooShort = KidbusterCore.analyzeBlitzOutput(tooShort);
    check('40 words -> warning under 70-120 target', warnTooShort.some(w => w.includes('under the 70-120')));

    const justRight = words(100);
    const warnJustRight = KidbusterCore.analyzeBlitzOutput(justRight);
    check('100 words -> no length warning at all', !warnJustRight.some(w => w.includes('word')));
  }

  console.log('\n7) Validator: no emojis');
  {
    const withEmoji = words(90) + ' 🎉';
    const warn = KidbusterCore.analyzeBlitzOutput(withEmoji);
    check('comment with an emoji -> flagged', warn.some(w => w.includes('emoji')));

    const withoutEmoji = words(90);
    const warnClean = KidbusterCore.analyzeBlitzOutput(withoutEmoji);
    check('comment without emoji -> NOT flagged for emoji', !warnClean.some(w => w.includes('emoji')));
  }

  console.log('\n8) Validator: no bullet points or headings');
  {
    const withBullet = 'Great lesson.\n- practiced verbs\n- did homework\n' + words(80);
    check('bulleted list -> flagged', KidbusterCore.analyzeBlitzOutput(withBullet).some(w => w.includes('bullet')));

    const withNumberedList = 'Great lesson.\n1. practiced verbs\n2. did homework\n' + words(80);
    check('numbered list -> flagged as bullet-like', KidbusterCore.analyzeBlitzOutput(withNumberedList).some(w => w.includes('bullet')));

    const withHeading = '## Summary\n' + words(90);
    check('markdown heading -> flagged', KidbusterCore.analyzeBlitzOutput(withHeading).some(w => w.includes('heading')));

    const plain = words(90);
    const warnPlain = KidbusterCore.analyzeBlitzOutput(plain);
    check('plain prose -> NOT flagged for bullets or headings', !warnPlain.some(w => w.includes('bullet') || w.includes('heading')));
  }

  console.log('\n9) Validator: leftover placeholder detection');
  {
    const withPlaceholder = 'Great job today, [Student]! ' + words(85);
    const warn = KidbusterCore.analyzeBlitzOutput(withPlaceholder);
    check('literal [Student] left in output -> flagged', warn.some(w => w.includes('placeholder') && w.includes('[Student]')));

    const filled = 'Great job today, Oscar! ' + words(85);
    const warnFilled = KidbusterCore.analyzeBlitzOutput(filled);
    check('placeholder properly filled in -> NOT flagged', !warnFilled.some(w => w.includes('placeholder')));
  }

  console.log('\n10) PROTOCOLS.BLITZ.analyze wraps analyzeBlitzOutput correctly (ignores rating/teacher/lengthFormat args)');
  {
    const text = words(100);
    const viaProtocol = KidbusterCore.PROTOCOLS.BLITZ.analyze(text, '4', 'Nina', 'short');
    const direct = KidbusterCore.analyzeBlitzOutput(text);
    check('PROTOCOLS.BLITZ.analyze gives same result regardless of extra args', JSON.stringify(viaProtocol) === JSON.stringify(direct));
  }

  console.log('\n11) Shuffle bag: all 10 models used once before any repeat');
  {
    KidbusterCore.resetBlitzShuffleBag();
    const seenInCycle = [];
    for(let i = 0; i < 10; i++){
      const prompt = KidbusterCore.buildBlitzSystemPrompt({});
      const matches = KidbusterCore.BLITZ_MODEL_POOL.filter(m => prompt.includes(m.text));
      seenInCycle.push(matches.length === 1 ? matches[0].key : null);
    }
    const uniqueInCycle = new Set(seenInCycle.filter(Boolean));
    check('10 draws after reset -> exactly 10 distinct models, no repeats', uniqueInCycle.size === 10 && seenInCycle.every(Boolean));

    // 11th draw must come from a freshly reshuffled bag (i.e. still a valid model)
    const prompt11 = KidbusterCore.buildBlitzSystemPrompt({});
    const match11 = KidbusterCore.BLITZ_MODEL_POOL.filter(m => prompt11.includes(m.text));
    check('11th draw (bag refilled) -> still exactly one valid model', match11.length === 1);

    // Run several full cycles and confirm every cycle of 10 is a full permutation
    KidbusterCore.resetBlitzShuffleBag();
    let allCyclesClean = true;
    for(let cycle = 0; cycle < 5; cycle++){
      const cycleKeys = [];
      for(let i = 0; i < 10; i++){
        const prompt = KidbusterCore.buildBlitzSystemPrompt({});
        const matches = KidbusterCore.BLITZ_MODEL_POOL.filter(m => prompt.includes(m.text));
        if(matches.length !== 1){ allCyclesClean = false; break; }
        cycleKeys.push(matches[0].key);
      }
      if(new Set(cycleKeys).size !== 10) allCyclesClean = false;
    }
    check('5 consecutive cycles of 10 draws -> each cycle is a full, repeat-free permutation', allCyclesClean);
  }

  console.log('\n12) Relaxed word-count floor: 70-120 target, 150 hard ceiling');
  {
    const at70 = words(70);
    check('70 words -> no length warning (new floor)', !KidbusterCore.analyzeBlitzOutput(at70).some(w => w.includes('word')));

    const at69 = words(69);
    const warn69 = KidbusterCore.analyzeBlitzOutput(at69);
    check('69 words -> under 70-120 target warning', warn69.some(w => w.includes('under the 70-120')));

    const at135 = words(135);
    const warn135 = KidbusterCore.analyzeBlitzOutput(at135);
    check('135 words -> over 70-120 target warning, not CRITICAL', warn135.some(w => w.includes('70-120')) && !warn135.some(w => w.includes('CRITICAL')));

    const at160 = words(160);
    check('160 words -> still CRITICAL over 150 hard ceiling (unchanged)', KidbusterCore.analyzeBlitzOutput(at160).some(w => w.includes('CRITICAL') && w.includes('150')));

    const prompt = KidbusterCore.buildBlitzSystemPrompt({ forcedModelKey: 'standard' });
    check('prompt now says "70-120 words"', prompt.includes('70-120 words'));
    check('prompt no longer says the old "80-120 words"', !prompt.includes('80-120 words'));
  }

  console.log('\n13) Anti-copying: prompt instruction + validator safety net');
  {
    const prompt = KidbusterCore.buildBlitzSystemPrompt({ forcedModelKey: 'standard' });
    check('prompt contains "Never copy the selected model verbatim"', prompt.includes('Never copy the selected model verbatim'));
    check('prompt tells the model to rewrite using this lesson\'s own evidence', prompt.includes('naturally rewriting every sentence using this lesson\'s own evidence'));

    // A near-verbatim reproduction of the Standard model (only the bracketed
    // parts changed) should be caught by the shingle-matching safety net.
    const copiedComment = "Excellent job today, Oscar! We practiced animal vocabulary and you completed today's activities with good focus. You showed a solid understanding of the lesson and were able to apply what we learned during class. Keep reviewing today's material and continue practicing between lessons. The more we practice together, the more confident you will become. See you next class!";
    const warnCopied = KidbusterCore.analyzeBlitzOutput(copiedComment);
    check('near-verbatim copy of the Standard model -> flagged', warnCopied.some(w => w.includes('reproduces wording') && w.includes('Standard')));

    // A genuinely rewritten comment inspired by the same model's structure
    // should NOT trip the check.
    const rewrittenComment = "Oscar had a strong lesson today, working through animal vocabulary with real focus and energy. He grasped the core ideas quickly and applied them confidently during our activities. Going forward, a bit more review of the trickier words at home would help lock things in. Nice progress overall, and I'm looking forward to building on it next time.";
    const warnRewritten = KidbusterCore.analyzeBlitzOutput(rewrittenComment);
    check('genuinely rewritten comment (same topic, different wording) -> NOT flagged for copying', !warnRewritten.some(w => w.includes('reproduces wording')));
  }

  console.log('\n14) Lesson Evidence Rule: Blitz formally supports any evidence type, not just a full transcript');
{
  const prompt = KidbusterCore.buildBlitzSystemPrompt({ forcedModelKey: 'standard' });
  check('has a named "LESSON EVIDENCE RULE (IMMUTABLE)" section', prompt.includes('LESSON EVIDENCE RULE (IMMUTABLE)'));
  check('explicitly lists transcript/teacher notes/summary/bullet points/combination as valid evidence', prompt.includes('a full transcript,') && prompt.includes('teacher notes,') && prompt.includes('a short lesson summary,') && prompt.includes('bullet points,') && prompt.includes('or any combination of these'));
  check('says to treat supplied evidence as the complete factual record of the lesson', prompt.includes('Treat all supplied lesson evidence as the complete factual record of the lesson'));
  check('explicitly rules out inventing behavioral observations, not just activities/vocabulary', prompt.includes('achievements, strengths, weaknesses, or behavioral observations'));
  check('says brief evidence should produce a naturally simpler comment, not filled-in assumptions', prompt.includes('generate a naturally simpler comment rather than filling missing information with assumptions'));
  check('design goal: explicitly states there is no separate manual mode', prompt.includes('There is no separate "manual mode"'));
  check('updated core rule uses the exact specified wording', prompt.includes('Use only information supported by the supplied lesson evidence. Lesson evidence may consist of a transcript, teacher notes, a short lesson summary, bullet points, or any combination of these. Never invent information beyond what the supplied evidence reasonably supports.'));
}

  console.log('\n15) Safe Inference Principle: the exact worked example is present, with correct safe/unsafe lists');
{
  const prompt = KidbusterCore.buildBlitzSystemPrompt({ forcedModelKey: 'standard' });
  check('has a named "SAFE INFERENCE PRINCIPLE" section', prompt.includes('SAFE INFERENCE PRINCIPLE'));
  check('includes the exact Timmy example evidence', prompt.includes('Timmy was great today. We did a lesson about colors and animals. He was very interested and we had a lot of fun.'));
  check('lists all 4 safe conclusions', ['Timmy participated well.', 'Lesson topics were colors and animals.', 'The atmosphere was positive.', 'The student was engaged.'].every(s => prompt.includes(s)));
  check('lists all 5 unsafe conclusions as things NOT to assume', ['Pronunciation improved.', 'Present Simple was practiced.', 'Reading exercises were completed.', 'Speaking confidence increased.', 'Vocabulary retention was excellent.'].every(s => prompt.includes(s)));
  check('validation checklist has a matching Safe Inference line', prompt.includes('Conclusions drawn are safe inferences from the supplied evidence, per the Safe Inference Principle'));
}

  console.log('\n16) Terminology consistency: "lesson evidence" replaces bare "notes"/"transcript" framing throughout, in both the prompt and the outgoing user message');
{
  const prompt = KidbusterCore.buildBlitzSystemPrompt({ forcedModelKey: 'standard' });
  check('no leftover "lesson transcript" phrasing implying evidence must be a full transcript', !prompt.includes('lesson transcript'));
  check('no leftover "the transcript actually supports" phrasing', !prompt.includes('the transcript actually supports'));
  check('safe-fallback phrasing for participation/effort still present', prompt.includes('stayed engaged throughout the lesson') || prompt.includes('worked steadily through today\'s activities'));
  check('still permits leaning toward the low end of the word target for brief evidence', prompt.includes('a shorter, honest comment near the low end of the target is correct and expected'));

  const msg = KidbusterCore.buildUserMessage({ studentName: 'Sam', notes: 'x', rating: '4', protocol: 'BLITZ' });
  check('outgoing user message now labels this "Lesson evidence", not "Lesson notes"', msg.includes('Lesson evidence ('));
  check('outgoing user message explains it may be transcript/notes/summary/bullet points/combination', msg.includes('teacher notes, a short summary, bullet points, or any combination'));
}

return getFailures();
};

if(require.main === module){
  const failures = module.exports();
  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}
