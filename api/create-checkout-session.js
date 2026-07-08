// Creates a Pro checkout session/URL via whichever payment provider is
// currently active (see api/_lib/providers/index.js) and hands the
// resulting URL back to the frontend to redirect to. Actual card entry
// and payment happen entirely on the provider's own hosted page, never
// in this app.
//
// This route deliberately knows nothing about Lemon Squeezy, Paddle, or
// any other provider's API — it only calls the active provider's
// createCheckoutUrl(), and only ever talks to license-service.js/
// licensing.js for anything license-related. Swapping providers never
// touches this file.
//
// Accepts EITHER an existing licenseKey (the normal path — a teacher
// upgrading from inside the app already has one stored, so there's no
// need to ask them for their email again) OR a bare email (for a fresh
// visitor going straight to Pro from outside the app, e.g. a marketing
// page, who's never signed up for a Free key at all).

import { getActiveProvider } from './_lib/providers/index.js';
import { getOrCreateFreeLicense } from './_lib/license-service.js';
import { getLicense, normalizeEmail } from './_lib/licensing.js';

function isValidEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, licenseKey: providedLicenseKey } = req.body || {};

  try{
    let licenseKey = providedLicenseKey;
    let resolvedEmail = null;

    if(licenseKey){
      const existing = await getLicense(licenseKey);
      if(!existing){
        return res.status(400).json({ error: 'That license key was not recognized.' });
      }
      resolvedEmail = existing.email || null;
    }else{
      if(!email || typeof email !== 'string' || !isValidEmail(email)){
        return res.status(400).json({ error: 'Please provide a valid email address, or an existing license key.' });
      }
      resolvedEmail = normalizeEmail(email);
      // Ensure a license key already exists for this email before checkout
      // — reuses the exact same idempotent logic as the Free signup
      // endpoint, so a teacher upgrading directly (without ever visiting
      // the Free flow first) still ends up with one consistent key.
      licenseKey = await getOrCreateFreeLicense(resolvedEmail);
    }

    const provider = getActiveProvider();
    const url = await provider.createCheckoutUrl({ email: resolvedEmail || '', licenseKey });

    return res.status(200).json({ url });
  }catch(err){
    console.error('create-checkout-session error:', err);
    return res.status(500).json({ error: 'Could not start checkout right now. Please try again shortly.' });
  }
}
