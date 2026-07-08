// Shared licensing/entitlement module — imported by api/generate.js,
// api/license-signup.js, api/create-checkout-session.js, and
// api/stripe-webhook.js. Has no default export, so Vercel never treats
// this file itself as a route.
//
// Deliberately split into two halves:
//   1. Pure functions (evaluateEntitlement, generateLicenseKey,
//      currentUsagePeriod, normalizeEmail) — no I/O at all, fully
//      unit-tested in tests/test-licensing.cjs without needing a real
//      KV/Stripe connection.
//   2. Thin Vercel KV wrappers — one line each, calling directly into
//      @vercel/kv's documented API. These can't be exercised by this
//      project's test suite (no live KV instance in that environment),
//      so keeping them this thin is deliberate: the less untested logic
//      they contain, the less that's actually at risk.
//
// Product shape (see DECISIONS.md for the full reasoning): exactly two
// plans, Free and Pro. Nothing more granular — no per-feature flags, no
// usage-based billing, no additional tiers. The one thing that's kept
// configurable, per explicit request, is the Free plan's monthly report
// limit and which protocol(s) it covers — everything else about "what
// Free vs Pro means" is intentionally hardcoded to keep this simple.

import crypto from 'crypto';
import { kv } from './kv-client.js';

// ---------- configuration (the only two things meant to be tunable) ----------

export const FREE_MONTHLY_LIMIT = parseInt(process.env.FREE_MONTHLY_LIMIT || '20', 10);
export const FREE_PLAN_PROTOCOLS = ['MA']; // Free tier is Classic (MA) only, by design

// ---------- pure logic (unit-tested directly, no I/O) ----------

/**
 * The single place that decides whether a generation request is allowed.
 * Deliberately "fails closed": any unrecognized plan/status value is
 * treated as the more restrictive case rather than accidentally granting
 * unlimited access on a data bug or a typo.
 *
 * @param {object} params
 * @param {string} params.plan - 'free' | 'pro' (anything else treated as 'free')
 * @param {string} params.status - 'active' | anything else (anything else = not allowed)
 * @param {string} params.protocol - the protocol key being requested (e.g. 'MA', 'BEIDA')
 * @param {number} params.usageCount - this license's generation count so far this month
 * @param {number} [params.freeMonthlyLimit] - defaults to FREE_MONTHLY_LIMIT
 * @param {string[]} [params.freeProtocols] - defaults to FREE_PLAN_PROTOCOLS
 * @returns {{allowed: boolean, reason: string|null, message: string|null}}
 */
export function evaluateEntitlement({ plan, status, protocol, usageCount, freeMonthlyLimit, freeProtocols }){
  const limit = typeof freeMonthlyLimit === 'number' ? freeMonthlyLimit : FREE_MONTHLY_LIMIT;
  const allowedFreeProtocols = freeProtocols || FREE_PLAN_PROTOCOLS;

  if(status !== 'active'){
    return {
      allowed: false,
      reason: 'inactive',
      message: 'This license is not active. If you believe this is a mistake, please contact support.'
    };
  }

  if(plan === 'pro'){
    return { allowed: true, reason: null, message: null };
  }

  // Anything that isn't exactly 'pro' (including 'free', missing, or an
  // unrecognized value) is treated as Free — the conservative default.
  if(!allowedFreeProtocols.includes(protocol)){
    return {
      allowed: false,
      reason: 'protocol_requires_pro',
      message: 'The ' + protocol + ' protocol is a Pro feature. Upgrade to Pro to unlock every protocol.'
    };
  }

  if(usageCount >= limit){
    return {
      allowed: false,
      reason: 'limit_reached',
      message: 'You\'ve used all ' + limit + ' free reports this month. Upgrade to Pro for unlimited reports and every protocol.'
    };
  }

  return { allowed: true, reason: null, message: null };
}

/**
 * Generates a new license key. Prefixed and formatted similarly to how
 * Stripe/other API providers format their own keys — recognizable at a
 * glance, greppable in logs, not easily confused with any other secret
 * this project uses (e.g. ANTHROPIC_API_KEY, APP_ACCESS_KEY).
 * @returns {string}
 */
export function generateLicenseKey(){
  return 'kb_live_' + crypto.randomBytes(24).toString('hex');
}

/**
 * Private owner/beta keys that should behave like Pro forever without a
 * payment provider. Kept in Vercel env, never in git. OWNER_LICENSE_KEYS
 * is the preferred name; FOUNDER_LICENSE_KEYS is kept as a backwards-
 * compatible alias because the live project already uses it.
 * @param {string} licenseKey
 * @returns {boolean}
 */
export function isFounderLicenseKey(licenseKey){
  if(!licenseKey) return false;
  const raw = [
    process.env.OWNER_LICENSE_KEYS || '',
    process.env.FOUNDER_LICENSE_KEYS || ''
  ].join(',');
  return raw
    .split(',')
    .map(key => key.trim())
    .filter(Boolean)
    .includes(licenseKey.trim());
}

/**
 * The current usage-tracking period, as a stable string key ('YYYY-MM',
 * UTC-based so it doesn't depend on server timezone). Usage resets
 * naturally every calendar month simply because this produces a new,
 * never-before-used KV key — no cron job or reset logic needed.
 * @param {Date} [date] - defaults to now; parameterized for testing
 * @returns {string}
 */
export function currentUsagePeriod(date){
  return (date || new Date()).toISOString().slice(0, 7);
}

/**
 * Normalizes an email for use as a KV lookup key — lowercased and
 * trimmed, so "Nina@Example.com" and " nina@example.com " resolve to the
 * same license record instead of silently creating two.
 * @param {string} email
 * @returns {string}
 */
export function normalizeEmail(email){
  return (email || '').trim().toLowerCase();
}

// ---------- Vercel KV I/O (thin wrappers, not unit-tested — see module comment) ----------

const licenseKeyFor = (key) => 'license:' + key;
const emailIndexFor = (email) => 'email:' + normalizeEmail(email);
const paymentCustomerIndexFor = (customerId) => 'paymentCustomer:' + customerId;
const usageKeyFor = (key, period) => 'usage:' + key + ':' + period;

export async function getLicense(licenseKey){
  if(!licenseKey) return null;
  return (await kv.get(licenseKeyFor(licenseKey))) || null;
}

export async function saveLicense(licenseKey, data){
  await kv.set(licenseKeyFor(licenseKey), data);
}

export async function getLicenseKeyByEmail(email){
  return (await kv.get(emailIndexFor(email))) || null;
}

export async function saveEmailIndex(email, licenseKey){
  await kv.set(emailIndexFor(email), licenseKey);
}

/**
 * "Payment customer id" is deliberately provider-neutral — whichever
 * payment provider is active (Lemon Squeezy, Paddle, or anything else
 * later), its own customer identifier gets stored and looked up under
 * this same name, so license-service.js never needs to know or care
 * which provider it came from.
 */
export async function getLicenseKeyByPaymentCustomerId(customerId){
  return (await kv.get(paymentCustomerIndexFor(customerId))) || null;
}

export async function savePaymentCustomerIndex(customerId, licenseKey){
  await kv.set(paymentCustomerIndexFor(customerId), licenseKey);
}

export async function getUsageCount(licenseKey, period){
  const count = await kv.get(usageKeyFor(licenseKey, period || currentUsagePeriod()));
  return typeof count === 'number' ? count : 0;
}

/**
 * Increments this license's usage counter for the current period and
 * sets it to expire ~40 days out — comfortably past month-end regardless
 * of which day the increment happened on, so old counters clean
 * themselves up automatically rather than accumulating forever.
 */
export async function incrementUsage(licenseKey, period){
  const key = usageKeyFor(licenseKey, period || currentUsagePeriod());
  const newCount = await kv.incr(key);
  await kv.expire(key, 60 * 60 * 24 * 40);
  return newCount;
}

// ---------- webhook duplicate/replay protection ----------
//
// Lemon Squeezy's signature scheme (HMAC-SHA256 over the raw body, no
// timestamp or nonce) proves a webhook was genuinely signed by the real
// secret, but proves nothing about WHEN — a validly-signed request can be
// resent later, either legitimately (Lemon Squeezy retries up to 3 times
// if a webhook doesn't respond 200) or maliciously (someone who captured
// a real request replaying it). Both cases look identical: the exact
// same raw body, arriving more than once. Recording a hash of every
// body actually processed, and skipping anything already seen, handles
// both uniformly without needing to tell them apart.

const webhookSeenKeyFor = (bodyHash) => 'webhookSeen:' + bodyHash;

export async function hasProcessedWebhook(bodyHash){
  return !!(await kv.get(webhookSeenKeyFor(bodyHash)));
}

/**
 * Marks a webhook body as processed. TTL is deliberately generous (30
 * days, comfortably longer than any provider's own retry window) — this
 * is about replay protection, not just deduping a same-minute retry, so
 * it needs to remember for longer than that.
 */
export async function markWebhookProcessed(bodyHash){
  await kv.set(webhookSeenKeyFor(bodyHash), true);
  await kv.expire(webhookSeenKeyFor(bodyHash), 60 * 60 * 24 * 30);
}
