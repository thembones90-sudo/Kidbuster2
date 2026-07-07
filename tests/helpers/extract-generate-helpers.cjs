'use strict';

/**
 * Extracts buildCacheableSystemBlocks (and its SYSTEM_PROMPT_DIVIDER
 * constant) directly out of api/generate.js — the backend proxy file,
 * which is an ES module (`export default`) and talks to the real
 * Anthropic API, neither of which this test suite wants to deal with
 * directly. Same extraction philosophy as extract-core.cjs: pull the real
 * function out of the real file rather than re-implementing/copying its
 * logic into the test, so a future edit to the split logic can't silently
 * diverge from what's actually tested.
 */

const fs = require('fs');
const path = require('path');

const GENERATE_JS_PATH = path.join(__dirname, '..', '..', 'api', 'generate.js');
const START_MARKER = "const SYSTEM_PROMPT_DIVIDER";
const END_MARKER = "\n}\n";

function extractBuildCacheableSystemBlocks(){
  const code = fs.readFileSync(GENERATE_JS_PATH, 'utf8');

  const startIdx = code.indexOf(START_MARKER);
  if(startIdx === -1){
    throw new Error(
      'extract-generate-helpers: could not find "' + START_MARKER + '" in api/generate.js. ' +
      'If it was renamed, update START_MARKER in tests/helpers/extract-generate-helpers.cjs.'
    );
  }

  // Find the end of the buildCacheableSystemBlocks function specifically —
  // the first "\n}\n" after its own opening, not SYSTEM_PROMPT_DIVIDER's.
  const fnStart = code.indexOf('function buildCacheableSystemBlocks', startIdx);
  if(fnStart === -1){
    throw new Error('extract-generate-helpers: found SYSTEM_PROMPT_DIVIDER but not the function itself.');
  }
  const endIdx = code.indexOf(END_MARKER, fnStart);
  if(endIdx === -1){
    throw new Error('extract-generate-helpers: found the function start but no matching closing "\\n}\\n" after it.');
  }

  const extractedCode = code.slice(startIdx, endIdx + END_MARKER.length);

  let buildCacheableSystemBlocks;
  try {
    const run = new Function(extractedCode + '\nreturn buildCacheableSystemBlocks;');
    buildCacheableSystemBlocks = run();
  } catch (err) {
    throw new Error('extract-generate-helpers: threw while evaluating — likely a real syntax error in api/generate.js. Original error: ' + err.message);
  }

  if(typeof buildCacheableSystemBlocks !== 'function'){
    throw new Error('extract-generate-helpers: extraction ran without error but did not produce a function.');
  }

  return { buildCacheableSystemBlocks };
}

module.exports = { extractBuildCacheableSystemBlocks };
