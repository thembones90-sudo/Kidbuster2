# Tests

Automated tests for the pure-logic parts of Kidbuster/Pathfinder — protocol
prompt construction, output validators, and the usage-stats tracker. No
external test framework and no dependencies (consistent with the rest of
this project) — just plain Node.

## Running

```bash
npm test
```

or run a single file directly while iterating on one area:

```bash
node tests/test-blitz.cjs
```

This also runs automatically on every push and pull request via
`.github/workflows/test.yml` — so a regression is caught before it ever
reaches Vercel, not after.

`test-browser-smoke.cjs` needs a real Chrome, downloaded automatically by
`puppeteer` (a devDependency) the first time `npm install` runs — this can
take a minute and download ~200MB the first time, which is normal. If no
browser is available at all in a given environment, that one file skips
itself with a clear message rather than failing the whole suite — every
other file has no such dependency and always runs.

## Why `.cjs`?

`package.json` has `"type": "module"`, which makes plain `.js` files ES
modules by default (no `require`). These tests use `require`/`module.exports`
for simplicity, so they're named `.cjs` to opt out of that on a per-file
basis — nothing else about the project's module setup changes.

## How this actually tests `index.html`

These tests don't maintain a separate copy of the app's logic that could
drift out of sync. `tests/helpers/extract-core.cjs` reads the *real*
`index.html`, finds the `KidbusterCore` IIFE by its exact start/end text,
and evaluates it directly to get the live object — so every test run is
against whatever is actually in `index.html` right now. Same idea for
`tests/helpers/extract-usage-stats.cjs`, which extracts the UI-layer
usage-stats block (`loadUsageStats`/`recordGeneration`/`kidbusterStats`),
providing minimal `localStorage`/`window` stubs since that code (unlike
`KidbusterCore`) isn't DOM-free by design.

If `index.html` is ever restructured enough that the extraction markers
no longer match (e.g. `KidbusterCore` is renamed, or its closing line
changes), the helper throws a clear error naming exactly which marker
failed and which file to update — rather than tests silently testing
stale, hand-copied logic instead of the real thing.

## What's covered

| File | Covers |
|---|---|
| `test-classic-protocol.cjs` | MA/Classic's foundational checks: ratings 1-2.5 omit stars while ratings 3 and above require exactly 10, the same star rule is enforced for Sugarcoat, Parent Note gating by rating, exactly-one Superpower emoji, exactly-one homework mission, empty-Grammar-Points detection, forbidden formatting, exact sign-off |
| `test-length-format.cjs` | Short/Medium/Long length tiers (MA/Sugarcoat): correct char targets, token substitution, validator enforcement per tier, backward-compatible default |
| `test-trim-rule.cjs` | The mandatory Short-tier content trim rule (omit Pronunciation Focus, cap grammar points/examples, drop per-word pronunciation) and its validator checks |
| `test-of-protocol.cjs` | OF's foundational checks: 3 required sections present and in order, independent 1300-char limits on Strengths/Areas for Improvement, 180-300 word range, qualitative-tier-leak guard, its generic "Cheers" (no-emoji) sign-off |
| `test-wolf-emoji.cjs` | Hidden teacher signature emoji defaults: Layne gets 🐺 in Classic, Faye gets 🧚 in Classic/Sugarcoat/OF, custom Classic sign-off emoji overrides still work, and Sugarcoat's 💖 stays intact |
| `test-blitz.cjs` | The Blitz protocol end to end: registry wiring, shuffle-bag model selection (no repeats until all 10 are used), 70-120/150 word validation, no-emoji/no-bullets/no-headings checks, leftover-placeholder detection, anti-verbatim-copying check |
| `test-special-remarks.cjs` | Special Remarks / "Teacher Notes" priority wording across MA/Sugarcoat/OF/Blitz, and the terminology bridge in the outgoing user message |
| `test-usage-stats.cjs` | Regression coverage for a real bug: `recordGeneration()` crashing for any protocol missing from the stats tracker's internal defaults (this is exactly what happened when Blitz was first added). Also covers the per-generation history log (full detail persisted per report, capped at 500 entries), `kidbusterHistory()`/`kidbusterExportHistoryCSV()`, the anonymous per-browser installation ID, failed-generation tracking (recorded to history without touching aggregate report counts/cost), and `kidbusterAnalytics()`'s local-only business-metric summary (success rate, average duration, protocol mix, peak hour) |
| `test-prompt-caching.cjs` | The prompt-caching split in `api/generate.js`: static protocol text is marked cacheable while the small per-request tail (rating, length tier) isn't, splitting/rejoining never loses a character, and different ratings genuinely share one identical cacheable block (covers MA, Sugarcoat, OF, Blitz, and Beida) |
| `test-payment-provider.cjs` | The payment-provider abstraction: the registry's provider selection via `PAYMENT_PROVIDER`, the Paddle stub's clear "not implemented" errors, and the Lemon Squeezy adapter's webhook signature verification (valid/invalid/missing/tampered), all four required event-name mappings, and irrelevant-event handling |
| `test-monetization-e2e.cjs` | The complete customer journey end to end, against the real route handlers (not just the underlying service functions) via a fake req/res harness: signup → hit the Free limit → real signed webhook upgrades to Pro → immediate unlimited access, no manual step → renewal → cancellation (same key, usage history preserved) — plus every failure path: invalid/forged license, expired vs. cancelled subscriptions, a webhook that never arrives, duplicate delivery, replay of a captured request, a simulated Vercel KV outage (proving the fail-open/fail-closed design decisions actually behave as intended, not just in theory), and Lemon Squeezy being unreachable |
| `test-licensing.cjs` | The core licensing module: `evaluateEntitlement`'s Free/Pro decision logic (the most business-critical function in the whole licensing system), license key generation, usage-period formatting, email normalization, and the KV-backed primitives (against a local test-only stub — see `node_modules/@vercel/kv` note in the file itself) |
| `test-license-service.cjs` | The License Service orchestration layer sitting between any payment provider and the app: idempotent Free signup, upgrading to Pro by key or by email fallback, downgrading by key or by payment-customer-id (the real webhook path), and the full realistic lifecycle a license actually goes through (signup → hit a Pro-only protocol → upgrade → use it → downgrade → blocked again) |
| `test-beida.cjs` | The Beida protocol — built to match an existing external platform's real two-field comment form (BetaKid), not our own invented structure: the required greeting format, per-field character limits taken directly from the real platform (200-2000 / 200-4000), the dual-header output split/parse logic, rating-driven guidance on whether an improvement area is required, and the real BetaKid example (adapted) passing validation cleanly |
| `test-browser-smoke.cjs` | Loads the real `index.html` in an actual headless browser (Puppeteer) and drives it like a person would — every other file in this suite tests pure logic without ever loading the page itself, which is exactly why a real UI-wiring bug (a `const` referenced before its declaration, crashing the rest of the script's top-level execution) went undetected until it was visually obvious. Checks for zero uncaught JS errors on load and after interaction, and that every protocol's body class, header badge text, and Generate button gradient all update correctly and distinctly — not just the CSS-only `:has()` fallback colors, which kept looking fine even while the JS side was completely broken. Skips gracefully (doesn't fail the suite) if no Puppeteer + Chrome install is available in the current environment |

## Adding a test for a new feature or protocol

1. Create `tests/test-your-thing.cjs` following the pattern in any existing
   file: `module.exports = function run(){ ... return getFailures(); }`,
   plus the `if(require.main === module)` block so it can run standalone.
2. `run-all.cjs` picks up any `test-*.cjs` file automatically — no
   registration needed elsewhere.
3. If a new protocol is added to `PROTOCOLS`, check whether anything in
   `index.html` still enumerates protocols by hand elsewhere (the usage-
   stats tracker did exactly this once and broke) — `test-usage-stats.cjs`
   is written generically over `Object.keys(PROTOCOLS)` specifically so it
   keeps catching this automatically for any protocol added in the future.
