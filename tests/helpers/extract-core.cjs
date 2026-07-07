'use strict';

/**
 * Extracts the KidbusterCore module directly out of the real index.html —
 * not a copy, not a snapshot maintained by hand. Every test run pulls
 * whatever is actually in index.html *right now*, so these tests can
 * never silently drift out of sync with the real app the way a manually
 * re-extracted copy would the moment someone edits a prompt or a function
 * without remembering to update a duplicate.
 *
 * How it works: KidbusterCore is a self-contained IIFE with no DOM
 * dependency (it never touches `document`/`window`), bounded by a fixed,
 * unindented start line and end line:
 *
 *   const KidbusterCore = (function(){
 *     ...
 *   })();
 *
 * We find that exact span in the raw HTML text and evaluate it with
 * `new Function(...)`, which runs it in its own scope and hands back
 * whatever `KidbusterCore` variable it defines — no temp files, no
 * regex-parsing of JS (which is a losing game), no dependency on line
 * numbers that shift every time the file is edited.
 */

const fs = require('fs');
const path = require('path');

const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'index.html');
const START_MARKER = 'const KidbusterCore = (function(){';
const END_MARKER = '\n})();';

function extractKidbusterCore(){
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

  const startIdx = html.indexOf(START_MARKER);
  if(startIdx === -1){
    throw new Error(
      'extract-core: could not find "' + START_MARKER + '" in index.html. ' +
      'If KidbusterCore was renamed or restructured, update START_MARKER in tests/helpers/extract-core.cjs to match.'
    );
  }

  const endIdx = html.indexOf(END_MARKER, startIdx);
  if(endIdx === -1){
    throw new Error(
      'extract-core: found the start of KidbusterCore but no matching "})();" after it. ' +
      'If the IIFE\'s closing line changed, update END_MARKER in tests/helpers/extract-core.cjs to match.'
    );
  }

  const code = html.slice(startIdx, endIdx + END_MARKER.length);

  let KidbusterCore;
  try {
    // Evaluated in its own function scope (not the surrounding page), so
    // it never touches or needs `document`/`window` — matches how the
    // module is actually written (pure logic, DOM-free by design).
    const run = new Function(code + '\nreturn KidbusterCore;');
    KidbusterCore = run();
  } catch (err) {
    throw new Error('extract-core: KidbusterCore threw while evaluating — likely a real syntax error in index.html. Original error: ' + err.message);
  }

  if(!KidbusterCore || typeof KidbusterCore !== 'object'){
    throw new Error('extract-core: extraction ran without error but did not produce a KidbusterCore object.');
  }

  return KidbusterCore;
}

module.exports = { extractKidbusterCore };
