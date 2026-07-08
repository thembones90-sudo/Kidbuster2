// Issues a Free-plan license key for a given email — no payment provider
// involved at all. Idempotent: calling this again with the same email
// returns the SAME existing key rather than minting a new one, so someone
// can't "re-signup" to quietly reset their usage counter, and a teacher
// who loses their key can always recover it by re-entering the same email.

import { getOrCreateFreeLicense } from './_lib/license-service.js';
import { getLicenseKeyByEmail, normalizeEmail } from './_lib/licensing.js';

function isValidEmail(email){
  // Deliberately simple — this is a signup gate, not full RFC 5322
  // validation. It just needs to catch "clearly not an email" typos.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body || {};
  if(!email || typeof email !== 'string' || !isValidEmail(email)){
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  try{
    const normalized = normalizeEmail(email);
    const alreadyExisted = !!(await getLicenseKeyByEmail(normalized));
    const licenseKey = await getOrCreateFreeLicense(normalized);
    return res.status(200).json({ licenseKey, plan: 'free', alreadyExisted });
  }catch(err){
    console.error('license-signup error:', err);
    return res.status(500).json({ error: 'Could not create a license key right now. Please try again shortly.' });
  }
}
