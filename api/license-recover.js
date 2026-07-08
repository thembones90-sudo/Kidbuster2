// Recovers an existing license key by email. This matches the current
// lightweight licensing model: no password accounts yet, just a stable
// email -> license key lookup in KV.

import { getLicenseKeyByEmail, normalizeEmail } from './_lib/licensing.js';

function isValidEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? normalizeEmail(email) : '';
  if(!normalizedEmail || !isValidEmail(normalizedEmail)){
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  try{
    const licenseKey = await getLicenseKeyByEmail(normalizedEmail);
    if(!licenseKey){
      return res.status(404).json({ error: 'No license key was found for that email.' });
    }
    return res.status(200).json({ licenseKey });
  }catch(err){
    console.error('license-recover error:', err);
    return res.status(500).json({ error: 'Could not recover a license key right now.' });
  }
}
