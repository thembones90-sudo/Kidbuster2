'use strict';
const { extractKidbusterCore } = require('./helpers/extract-core.cjs');
const { extractBuildCacheableSystemBlocks } = require('./helpers/extract-generate-helpers.cjs');
const { createChecker } = require('./helpers/assert.cjs');

/**
 * Tests the prompt-caching split in api/generate.js: the large, static
 * bulk of each protocol's system prompt should be marked cacheable
 * (cache_control), while the small per-request tail (rating, length
 * tier) stays uncached — and, critically, splitting and rejoining must
 * never lose or alter a single character of the original prompt, since
 * that prompt is what actually gets sent to the model.
 */
module.exports = function run(){
  const KidbusterCore = extractKidbusterCore();
  const { buildCacheableSystemBlocks } = extractBuildCacheableSystemBlocks();
  const { check, getFailures } = createChecker();

  console.log('\n=== test-prompt-caching.cjs ===');

  function checkRoundTrip(label, prompt){
    const blocks = buildCacheableSystemBlocks(prompt);
    const reconstructed = blocks.map(b => b.text).join('');
    check(label + ': splitting and rejoining reproduces the exact original prompt', reconstructed === prompt);
    return blocks;
  }

  console.log('\n1) MA/Sugarcoat/OF: split into a cacheable static block + an uncached dynamic tail');
  {
    const maPrompt = KidbusterCore.buildMASystemPrompt({ rating: '4', lengthFormat: 'long' });
    const maBlocks = checkRoundTrip('MA', maPrompt);
    check('MA -> exactly 2 blocks', maBlocks.length === 2);
    check('MA -> block[0] has cache_control ephemeral', maBlocks[0].cache_control && maBlocks[0].cache_control.type === 'ephemeral');
    check('MA -> block[1] has NO cache_control (the small per-request tail)', maBlocks[1].cache_control === undefined);
    check('MA -> block[0] contains the static rules, not the runtime params', maBlocks[0].text.includes('IMMUTABLE RULES') || maBlocks[0].text.includes('UNIVERSAL RULES'));
    check('MA -> block[1] contains the runtime params tail, not the static rules', maBlocks[1].text.includes('RUNTIME PARAMETERS FOR THIS REPORT'));
    check('MA -> static cacheable block is comfortably over the ~1024-token minimum (using ~4 chars/token as a rough floor check)', maBlocks[0].text.length > 4000);

    const sweetPrompt = KidbusterCore.buildSweetSystemPrompt({ rating: '3', lengthFormat: 'medium' });
    const sweetBlocks = checkRoundTrip('Sugarcoat', sweetPrompt);
    check('Sugarcoat -> exactly 2 blocks, static one cacheable', sweetBlocks.length === 2 && sweetBlocks[0].cache_control?.type === 'ephemeral');

    const ofPrompt = KidbusterCore.buildOFSystemPrompt({ rating: 'Medium' });
    const ofBlocks = checkRoundTrip('OF', ofPrompt);
    check('OF -> exactly 2 blocks, static one cacheable', ofBlocks.length === 2 && ofBlocks[0].cache_control?.type === 'ephemeral');

    const beidaPrompt = KidbusterCore.buildBeidaSystemPrompt({ rating: 'excellent' });
    const beidaBlocks = checkRoundTrip('Beida', beidaPrompt);
    check('Beida -> exactly 2 blocks, static one cacheable', beidaBlocks.length === 2 && beidaBlocks[0].cache_control?.type === 'ephemeral');
  }

  console.log('\n2) Blitz: no divider in its prompt, so the whole thing is cached as a single block');
  {
    const blitzPrompt = KidbusterCore.buildBlitzSystemPrompt({ forcedModelKey: 'standard' });
    const blitzBlocks = checkRoundTrip('Blitz', blitzPrompt);
    check('Blitz -> exactly 1 block (no divider to split on)', blitzBlocks.length === 1);
    check('Blitz -> that one block is cacheable', blitzBlocks[0].cache_control && blitzBlocks[0].cache_control.type === 'ephemeral');
    check('Blitz -> block text is the entire original prompt', blitzBlocks[0].text === blitzPrompt);
  }

  console.log('\n3) The split uses the LAST divider occurrence, not the first — MA\'s own text contains this divider internally too');
  {
    const maPrompt = KidbusterCore.buildMASystemPrompt({ rating: '2', lengthFormat: 'long' });
    const dividerCount = (maPrompt.match(/────────────────────────────────────────/g) || []).length;
    check('sanity check: MA prompt text really does contain the divider more than once internally', dividerCount > 1);

    const blocks = buildCacheableSystemBlocks(maPrompt);
    check('static block still contains earlier internal dividers (proves LAST-occurrence split, not first)', (blocks[0].text.match(/────────────────────────────────────────/g) || []).length === dividerCount - 1);
    check('dynamic tail contains exactly one divider (the one right before the runtime params)', (blocks[1].text.match(/────────────────────────────────────────/g) || []).length === 1);
  }

  console.log('\n4) Different ratings/length-tiers share the SAME static block (this is the actual cache win)');
  {
    const promptRating1 = KidbusterCore.buildMASystemPrompt({ rating: '1', lengthFormat: 'long' });
    const promptRating6 = KidbusterCore.buildMASystemPrompt({ rating: '6', lengthFormat: 'long' });
    const blocks1 = buildCacheableSystemBlocks(promptRating1);
    const blocks6 = buildCacheableSystemBlocks(promptRating6);
    check('rating 1 and rating 6 (same length tier) produce an IDENTICAL cacheable static block', blocks1[0].text === blocks6[0].text);
    check('...but genuinely different dynamic tails (proves this isn\'t a no-op check)', blocks1[1].text !== blocks6[1].text);

    const beidaExcellent = KidbusterCore.buildBeidaSystemPrompt({ rating: 'excellent' });
    const beidaTryHarder = KidbusterCore.buildBeidaSystemPrompt({ rating: 'try_harder' });
    const beidaBlocks1 = buildCacheableSystemBlocks(beidaExcellent);
    const beidaBlocks2 = buildCacheableSystemBlocks(beidaTryHarder);
    check('Beida: "Excellent" and "try harder please" ratings share an IDENTICAL cacheable static block', beidaBlocks1[0].text === beidaBlocks2[0].text);
    check('Beida: ...but genuinely different dynamic tails', beidaBlocks1[1].text !== beidaBlocks2[1].text);
  }

  return getFailures();
};

if(require.main === module){
  const failures = module.exports();
  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}
