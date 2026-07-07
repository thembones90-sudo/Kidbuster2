'use strict';

/**
 * Minimal pass/fail checker shared by every test file — no external test
 * framework dependency, consistent with this project's near-zero-
 * dependency philosophy (package.json has none at all today). Each test
 * file gets its own isolated counter via createChecker(), so requiring
 * multiple test files into one run (see run-all.cjs) never mixes up which
 * failures belong to which file.
 */
function createChecker(){
  let failures = 0;
  function check(label, cond){
    if(cond){ console.log('  PASS  ' + label); }
    else{ console.log('  FAIL  ' + label); failures++; }
  }
  return { check, getFailures: () => failures };
}

module.exports = { createChecker };
