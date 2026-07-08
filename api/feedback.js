// Kidbuster field-test feedback endpoint.
//
// Receives a star score + optional comment about a generated report's
// quality (not a rating of the student/lesson — that's a separate,
// existing concept) and forwards it to a Google Sheet via an Apps Script
// webhook, so feedback lands somewhere the developer can actually see it
// instead of being trapped in each teacher's own browser localStorage.

import { getLicense, isFounderLicenseKey } from './_lib/licensing.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Same lightweight shared-secret gate as /api/generate — keeps random
  // strangers who find the URL from spamming the sheet with junk rows.
  const expectedKey = process.env.APP_ACCESS_KEY;
  const providedKey = req.headers['x-app-key'];
  let keyAllowed = !!(expectedKey && providedKey === expectedKey);
  if (!keyAllowed && providedKey) {
    try {
      const license = await getLicense(providedKey);
      keyAllowed = isFounderLicenseKey(providedKey) || !!(license && license.status === 'active');
    } catch (err) {
      console.error('feedback license check failed:', err);
      return res.status(500).json({ error: 'Could not verify feedback access right now' });
    }
  }
  if (!keyAllowed) {
    return res.status(401).json({ error: 'Invalid or missing access key' });
  }

  const { teacherName, protocol, ratingTier, score, comment } = req.body || {};

  const numericScore = Number(score);
  if (!Number.isInteger(numericScore) || numericScore < 1 || numericScore > 5) {
    return res.status(400).json({ error: 'score must be an integer from 1 to 5' });
  }

  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('GOOGLE_SHEET_WEBHOOK_URL is not set');
    return res.status(500).json({ error: 'Feedback storage is not configured' });
  }

  // Trim/cap everything — this is field-test telemetry, not a place for
  // arbitrarily large payloads to land in a spreadsheet cell.
  const payload = {
    timestamp: new Date().toISOString(),
    teacherName: String(teacherName || 'Unknown').slice(0, 100),
    protocol: String(protocol || '').slice(0, 20),
    ratingTier: String(ratingTier || '').slice(0, 30),
    score: numericScore,
    comment: String(comment || '').slice(0, 1000)
  };

  try {
    const sheetResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!sheetResponse.ok) {
      return res.status(502).json({ error: 'Failed to record feedback' });
    }
  } catch (err) {
    return res.status(502).json({ error: 'Network error contacting feedback storage' });
  }

  return res.status(200).json({ status: 'ok' });
}
