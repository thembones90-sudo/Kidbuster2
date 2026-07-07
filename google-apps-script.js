/**
 * KIDBUSTER FEEDBACK RECEIVER — Google Apps Script
 *
 * This is NOT part of the Vercel deployment. It runs inside Google's own
 * infrastructure, attached to a Google Sheet you create. It receives
 * feedback submissions from /api/feedback and appends one row per
 * submission.
 *
 * SETUP (one-time):
 * 1. Go to sheets.google.com, create a new blank spreadsheet.
 *    Name it whatever you like, e.g. "Kidbuster Feedback".
 * 2. In that sheet, add a header row (row 1) with these exact columns:
 *    Timestamp | Teacher | Protocol | Rating Tier | Score | Comment
 * 3. Extensions menu → Apps Script. This opens a script editor tied to
 *    this specific sheet.
 * 4. Delete whatever placeholder code is there, and paste this entire
 *    file in its place.
 * 5. Click Deploy → New deployment.
 *    - Select type: Web app
 *    - Description: anything, e.g. "Kidbuster feedback receiver"
 *    - Execute as: Me (your own Google account)
 *    - Who has access: Anyone
 *      (This sounds alarming, but it only exposes THIS specific script's
 *      doPost function, not your sheet or your Google account. It's how
 *      Apps Script web apps work — the URL itself is the only real
 *      protection here, plus Kidbuster's own APP_ACCESS_KEY gate on the
 *      /api/feedback endpoint before anything ever reaches this script.)
 * 6. Click Deploy. Authorize it (Google will ask for permission the
 *    first time — this is your own script accessing your own sheet).
 * 7. Copy the resulting "Web app URL" — it looks like:
 *    https://script.google.com/macros/s/AKfycb.../exec
 * 8. Put that URL into Vercel's environment variables as
 *    GOOGLE_SHEET_WEBHOOK_URL, then redeploy (or Vercel will pick it up
 *    on the next push).
 *
 * If you ever change this script's code later, you need to create a NEW
 * deployment (Deploy → Manage deployments → Edit → New version) for the
 * changes to actually take effect at the same URL.
 */

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);

  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.teacherName || '',
    data.protocol || '',
    data.ratingTier || '',
    data.score || '',
    data.comment || ''
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
