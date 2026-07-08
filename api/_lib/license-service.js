// License Service — the middle layer in this architecture:
//
//   Payment Provider  →  License Service  →  Kidbuster
//
// This module is the ONLY thing that knows how to create, upgrade,
// downgrade, and check licenses. It has zero knowledge of Stripe, Lemon
// Squeezy, Paddle, or any other payment provider — it only deals in
// plain concepts (a license key, an email, a plan, a Stripe/LS/Paddle
// customer+subscription id pair). A payment provider adapter's only job
// (see api/_lib/providers/) is to turn that provider's own webhook
// format into a call to one of the four functions below:
//
//   payment succeeded    → activateOrRenewPro(...)
//   subscription renewed → activateOrRenewPro(...)   (same effect)
//   subscription canceled → downgradeToFree(...)
//   subscription expired  → downgradeToFree(...)      (same effect, for now — see comment below)
//
// api/generate.js calls checkEntitlement()/recordUsage() and never
// imports a payment provider at all — swapping providers later means
// writing a new file in api/_lib/providers/, nothing else in this file
// or in api/generate.js needs to change.

import {
  generateLicenseKey, currentUsagePeriod, evaluateEntitlement,
  getLicense, saveLicense, getLicenseKeyByEmail, saveEmailIndex,
  getLicenseKeyByPaymentCustomerId, savePaymentCustomerIndex,
  getUsageCount, incrementUsage, normalizeEmail
} from './licensing.js';

/**
 * Returns the existing license key for this email, or creates a new
 * Free-plan one if none exists yet. Idempotent — safe to call from both
 * the Free signup flow and the start of a Pro checkout (a teacher
 * upgrading directly, without ever visiting the Free flow first, still
 * gets one consistent key rather than two separate records).
 * @param {string} email
 * @returns {Promise<string>} the license key
 */
export async function getOrCreateFreeLicense(email){
  const normalized = normalizeEmail(email);
  const existingKey = await getLicenseKeyByEmail(normalized);
  if(existingKey) return existingKey;

  // Write order here is deliberately the OPPOSITE of activateOrRenewPro's:
  // the license record is the new, authoritative thing being created, so
  // it's written FIRST. If the email-index write that follows fails, the
  // worst case is a future signup with the same email not finding this
  // key and creating a second, independent Free license instead — a mild,
  // recoverable duplication, not a permanently broken or stuck license.
  // The reverse order (index first) would risk the index pointing at a
  // license key whose record was never actually saved.
  const licenseKey = generateLicenseKey();
  await saveLicense(licenseKey, {
    email: normalized,
    plan: 'free',
    status: 'active',
    paymentCustomerId: null,
    paymentSubscriptionId: null,
    createdAt: new Date().toISOString()
  });
  await saveEmailIndex(normalized, licenseKey);
  return licenseKey;
}

/**
 * Grants (or renews) Pro access. Called for both an initial successful
 * payment and a recurring renewal payment — both have the identical
 * effect on a license record, so there's no need for two functions.
 * Resolves which license record to update via licenseKey first (the
 * normal path, threaded through the provider's own custom-data /
 * passthrough mechanism from checkout), falling back to an email lookup,
 * and creates a fresh record if genuinely neither exists yet — a real
 * payment should never be silently dropped just because the expected
 * identifiers didn't come through.
 * @param {object} params
 * @param {string} [params.licenseKey]
 * @param {string} [params.email]
 * @param {string} params.paymentCustomerId - the provider's own customer id
 * @param {string} params.paymentSubscriptionId - the provider's own subscription id
 */
export async function activateOrRenewPro({ licenseKey, email, paymentCustomerId, paymentSubscriptionId }){
  const normalizedEmail = email ? normalizeEmail(email) : null;
  let resolvedKey = licenseKey || (normalizedEmail ? await getLicenseKeyByEmail(normalizedEmail) : null);

  let existing = resolvedKey ? await getLicense(resolvedKey) : null;
  if(!resolvedKey || !existing){
    resolvedKey = resolvedKey || generateLicenseKey();
    existing = {
      email: normalizedEmail || '',
      plan: 'free',
      status: 'active',
      paymentCustomerId: null,
      paymentSubscriptionId: null,
      createdAt: new Date().toISOString()
    };
  }

  // Write order matters here, since KV offers no multi-key transaction —
  // if one of these writes fails partway through, whichever ordering was
  // chosen determines which INCONSISTENT state is possible, not whether
  // one is. Indexes are written FIRST, and the actual license record
  // (the thing that flips plan to 'pro') is written LAST and deliberately
  // treated as the single source of truth: if it never gets reached, the
  // customer just isn't upgraded yet — safe and retryable, since a
  // webhook retry naturally re-attempts the whole thing. The opposite
  // order is worse: a license already marked 'pro' with a missing
  // customer-id index would be undiscoverable by any future cancellation
  // webhook (which looks up by that index), leaving the customer
  // permanently Pro with no way to ever downgrade them automatically.
  if(paymentCustomerId){
    await savePaymentCustomerIndex(paymentCustomerId, resolvedKey);
  }
  if(normalizedEmail){
    await saveEmailIndex(normalizedEmail, resolvedKey);
  }

  await saveLicense(resolvedKey, {
    ...existing,
    email: normalizedEmail || existing.email,
    plan: 'pro',
    status: 'active',
    paymentCustomerId: paymentCustomerId || existing.paymentCustomerId,
    paymentSubscriptionId: paymentSubscriptionId || existing.paymentSubscriptionId
  });

  return resolvedKey;
}

/**
 * Ends Pro access, falling back to Free rather than deactivating the
 * license entirely — a lapsed or canceled subscription means losing Pro
 * perks, not losing the account. The teacher keeps the same key and their
 * Free-tier allowance.
 *
 * Currently used identically for both "canceled" and "expired" —
 * deliberately simple for now (matches the product's own "just Free and
 * Pro, nothing fancier" philosophy) rather than modeling a grace period
 * between cancellation and actual access loss. If that's ever wanted,
 * this is the one place it would change.
 * @param {object} params
 * @param {string} [params.licenseKey]
 * @param {string} [params.paymentCustomerId]
 */
export async function downgradeToFree({ licenseKey, paymentCustomerId }){
  const resolvedKey = licenseKey || (paymentCustomerId ? await getLicenseKeyByPaymentCustomerId(paymentCustomerId) : null);
  if(!resolvedKey) return null;

  const existing = await getLicense(resolvedKey);
  if(!existing) return null;

  await saveLicense(resolvedKey, {
    ...existing,
    plan: 'free',
    paymentSubscriptionId: null
  });
  return resolvedKey;
}

/**
 * The single check api/generate.js calls before ever proxying to
 * Anthropic. Bundles the license lookup, current usage count, and the
 * pure entitlement decision into one call so the route handler doesn't
 * need to know about KV keys or usage-period formatting at all.
 * @param {string} licenseKey
 * @param {string} protocol
 * @returns {Promise<{allowed: boolean, reason: string|null, message: string|null, license: object|null}>}
 */
export async function checkEntitlement(licenseKey, protocol){
  const license = await getLicense(licenseKey);
  if(!license){
    return { allowed: false, reason: 'invalid_key', message: 'Invalid license key.', license: null };
  }

  const period = currentUsagePeriod();
  const usageCount = await getUsageCount(licenseKey, period);
  const result = evaluateEntitlement({
    plan: license.plan,
    status: license.status,
    protocol,
    usageCount
  });

  return { ...result, license };
}

/**
 * Records one generation against this license's usage for the current
 * period. Called only after a report has actually, successfully been
 * delivered — a failed or empty generation was never billed against the
 * teacher's Free allowance.
 * @param {string} licenseKey
 */
export async function recordUsage(licenseKey){
  await incrementUsage(licenseKey, currentUsagePeriod());
}
