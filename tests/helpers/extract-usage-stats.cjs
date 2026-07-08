'use strict';

/**
 * Extracts and runs the usage-stats tracker (loadUsageStats, recordGeneration,
 * window.kidbusterStats) directly out of index.html. This code lives in the
 * UI layer, outside KidbusterCore, and genuinely needs `localStorage` and
 * `window` — so unlike extract-core.cjs, this provides minimal in-memory
 * stubs for both rather than assuming a DOM-free module.
 *
 * This exists specifically because this exact block caused a real
 * production bug once already: when the Blitz protocol was added, this
 * code was never updated to know about it, so recordGeneration('BLITZ', ...)
 * crashed reading `.reports` off of `undefined`. See tests/test-usage-stats.cjs.
 */

const fs = require('fs');
const path = require('path');

const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'index.html');
const START_MARKER = 'const USAGE_STATS_KEY';
const END_MARKER = "\n  return { total: history.length, successful: successEntries.length, failed: errorEntries.length, successRate, avgDurationMs, byProtocol, byDay, byHour, peakHour };\n};";

function extractUsageStatsModule(){
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8').replace(/\r\n/g, '\n');

  const startIdx = html.indexOf(START_MARKER);
  if(startIdx === -1){
    throw new Error(
      'extract-usage-stats: could not find "' + START_MARKER + '" in index.html. ' +
      'If this block was renamed, update START_MARKER in tests/helpers/extract-usage-stats.cjs.'
    );
  }

  const endIdx = html.indexOf(END_MARKER, startIdx);
  if(endIdx === -1){
    throw new Error(
      'extract-usage-stats: found the start but not the expected analytics closing marker after it. ' +
      'If window.kidbusterStats\'s closing changed, update END_MARKER in tests/helpers/extract-usage-stats.cjs.'
    );
  }

  const code = html.slice(startIdx, endIdx + END_MARKER.length);

  // Minimal in-memory localStorage stub — enough for getItem/setItem, which
  // is all this block uses. A fresh instance per call, so tests don't leak
  // state into each other.
  const localStorageStub = {
    _data: {},
    getItem(key){ return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null; },
    setItem(key, value){ this._data[key] = String(value); },
    removeItem(key){ delete this._data[key]; }
  };
  const windowStub = {};

  let result;
  try {
    // Runs with `localStorage` and `window` bound as parameters (not
    // globals) so this stays fully isolated per call — no cross-test
    // pollution via a shared global.
    const run = new Function(
      'localStorage', 'window',
      code + '\nreturn { loadUsageStats, recordGeneration, recordFailedGeneration, loadGenerationHistory, getInstallationId, kidbusterStats: window.kidbusterStats, kidbusterHistory: window.kidbusterHistory, kidbusterExportHistoryCSV: window.kidbusterExportHistoryCSV, kidbusterAnalytics: window.kidbusterAnalytics };'
    );
    result = run(localStorageStub, windowStub);
  } catch (err) {
    throw new Error('extract-usage-stats: threw while evaluating — likely a real syntax error in index.html. Original error: ' + err.message);
  }

  if(!result || typeof result.recordGeneration !== 'function'){
    throw new Error('extract-usage-stats: extraction ran without error but did not produce the expected functions.');
  }

  return result;
}

module.exports = { extractUsageStatsModule };
