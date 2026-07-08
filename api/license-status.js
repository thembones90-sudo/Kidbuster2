// Returns the current license/account status for the key saved in the
// browser. This is deliberately read-only: it never creates, upgrades, or
// downgrades anything.

import {
  FREE_MONTHLY_LIMIT,
  currentUsagePeriod,
  getLicense,
  getUsageCount,
  isFounderLicenseKey
} from './_lib/licensing.js';

export default async function handler(req, res){
  if(req.method !== 'GET'){
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const licenseKey = req.headers['x-app-key'];
  if(!licenseKey){
    return res.status(401).json({ error: 'A license key is required.' });
  }

  try{
    const period = currentUsagePeriod();

    if(isFounderLicenseKey(licenseKey)){
      return res.status(200).json({
        plan: 'pro',
        status: 'active',
        founder: true,
        email: '',
        usagePeriod: period,
        usageCount: 0,
        freeMonthlyLimit: FREE_MONTHLY_LIMIT,
        remainingFreeReports: null
      });
    }

    const license = await getLicense(licenseKey);
    if(!license){
      return res.status(401).json({ error: 'Invalid license key.' });
    }

    const usageCount = await getUsageCount(licenseKey, period);
    const isFree = license.plan !== 'pro';
    return res.status(200).json({
      plan: license.plan || 'free',
      status: license.status || 'inactive',
      founder: false,
      email: license.email || '',
      usagePeriod: period,
      usageCount,
      freeMonthlyLimit: FREE_MONTHLY_LIMIT,
      remainingFreeReports: isFree ? Math.max(0, FREE_MONTHLY_LIMIT - usageCount) : null
    });
  }catch(err){
    console.error('license-status error:', err);
    return res.status(500).json({ error: 'Could not check license status right now.' });
  }
}
