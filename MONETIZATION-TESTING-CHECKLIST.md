# Manual Testing Checklist — Monetization Flow

Run through this once, start to finish, using Lemon Squeezy's **Test mode**
(a completely separate environment from your live store — test products,
test customers, test webhooks, no real money). Do this *before* switching
to live mode and inviting real beta users. Every item here is something
the automated suite (`npm test`, specifically `tests/test-monetization-e2e.cjs`)
already proves works in isolation — this checklist is about proving the
*real* integration works: real Lemon Squeezy dashboard, real webhook
delivery over the real network, real Vercel deployment.

## 0. Before you start

- [ ] Your Lemon Squeezy store is in **Test mode** (toggle bottom-left of the dashboard — new stores default to this).
- [ ] You've created a **Pro** subscription product in test mode, with a **Test mode API key**, and noted the **Store ID** and the Pro product's **Variant ID**.
- [ ] `.env.example` values are all set in Vercel (or your local `.env` for `vercel dev`) — `LEMONSQUEEZY_API_KEY`/`STORE_ID`/`PRO_VARIANT_ID` are the **test mode** ones for now.
- [ ] A webhook is configured in Lemon Squeezy (Settings → Webhooks) pointing at `https://yourdomain.vercel.app/api/payment-webhook`, subscribed to at minimum: `subscription_created`, `subscription_payment_success`, `subscription_cancelled`, `subscription_expired`. The signing secret you typed there matches `LEMONSQUEEZY_WEBHOOK_SECRET` exactly.
- [ ] **Optional, but makes step 6 below much faster:** consider temporarily lowering `FREE_MONTHLY_LIMIT` to something small (e.g. `2`) for this test run, so you don't have to generate 20 real reports by hand. Set it back to `20` before inviting real users.

## 1. Free signup

- [ ] Open the deployed app in a fresh incognito window (no stored key).
- [ ] Click **Get my free key**, enter a real email address you can check.
- [ ] Confirm a license key appears and the app becomes usable — no payment step anywhere in this path.
- [ ] Reload the page. Confirm the key is remembered (you're not asked again).
- [ ] Enter the *same* email again via a different browser/incognito window (simulating "I forgot my key"). Confirm you get back the **same** key, not a new one.

## 2. Free plan enforcement

- [ ] With a Free key, select **Classic (MA)** and generate a report. Confirm it works normally.
- [ ] Switch to any other protocol (Blitz, Sugarcoat, OF, Beida) and try to generate. Confirm it's blocked with a clear message naming that protocol and mentioning Pro — not a generic error.
- [ ] Generate Classic reports until you hit your configured limit (2, or 20, whichever you set). Confirm the *last allowed* generation still works normally, and the *next* one is blocked.
- [ ] Confirm the blocked message clearly states the limit and includes a working **Upgrade to Pro** button.

## 3. Upgrading to Pro (the real checkout)

- [ ] Click **Upgrade to Pro**. Confirm you're redirected to a genuine Lemon Squeezy checkout page (not an error).
- [ ] Complete checkout using a [Lemon Squeezy test card](https://docs.lemonsqueezy.com/help/getting-started/test-mode) — **never a real card in test mode**, LS may flag it as fraud. Any future expiry date, any 3-digit CVC.
- [ ] After completing checkout, confirm you land back on the app (the `success_url` redirect).
- [ ] Check the Lemon Squeezy dashboard (Test mode → Orders/Subscriptions) — confirm a new test subscription was actually created.
- [ ] Check Lemon Squeezy's webhook log (Settings → Webhooks → click your webhook → recent deliveries) — confirm a `subscription_created` event was sent and shows a **200** response from your app.

## 4. Immediate Pro access — no manual step

- [ ] Back in the app (same browser, same stored key — don't re-enter anything), try a Pro-only protocol (e.g. Beida). Confirm it now works immediately.
- [ ] Confirm Classic no longer shows any limit warning, even past whatever count you hit in step 2.
- [ ] If it *doesn't* work immediately: check Vercel's function logs for `api/payment-webhook` around the time you completed checkout — this is the one step with a real network dependency (Lemon Squeezy → your server), so a few seconds of delay before Pro kicks in is normal; anything longer than ~30 seconds means check the webhook log in step 3 for a non-200 response.

## 5. Renewal

Real renewals happen monthly — too slow to wait for. Use Lemon Squeezy's **Simulate event** feature instead:

- [ ] In the Lemon Squeezy dashboard, open the test subscription you just created → find **Simulate event** in its side panel.
- [ ] Trigger `subscription_payment_success`.
- [ ] Confirm the webhook log shows a 200 response, and the app still has full Pro access afterward (nothing should visibly change — that's correct, renewal just keeps things as they were).

## 6. Cancellation

- [ ] From the same test subscription, use **Simulate event** to trigger `subscription_cancelled` (or actually cancel it through the Lemon Squeezy Customer Portal link, if you have that enabled, for a more realistic test).
- [ ] Back in the app, confirm Pro access is gone — a Pro-only protocol is blocked again, same as a fresh Free account.
- [ ] Confirm it's the **same license key** as before (check your browser's stored key, or just confirm you weren't asked to sign up again) — cancellation should fall back to Free, not wipe the account.
- [ ] Confirm your report count from before the upgrade is still remembered (if you're near the Free limit again, you should be blocked again immediately, not given a fresh 20).

## 7. Expiration

- [ ] Same as step 6, but trigger `subscription_expired` instead of `subscription_cancelled`. Confirm the same downgrade-to-Free behavior.

## 8. Duplicate / replay resilience

- [ ] In the Lemon Squeezy webhook log (Settings → Webhooks → recent deliveries), find any event you triggered above and click **Resend**.
- [ ] Confirm your app still returns 200 (check Vercel logs — you should see a log line noting it was recognized as a duplicate).
- [ ] Confirm nothing about the license changed as a result (still whatever plan it was already on).

## 9. Failure messaging sanity check

- [ ] In the app, manually clear your stored key (browser dev tools → Application → Local Storage → delete the key) and try generating. Confirm you're prompted to sign up or enter a key again, not shown a raw error.
- [ ] Try entering an obviously fake key (`kb_live_not_real`) in the "already have a key" field. Confirm you get a clear "invalid license" message on the next generation attempt, not a silent failure.

## 10. Going live

Once everything above passes in test mode:

- [ ] In Lemon Squeezy, use **Copy to Live Mode** on your Pro product (note: this gives it a **new** variant ID).
- [ ] Generate a **live mode** API key.
- [ ] Add a **second** webhook, this time in live mode, pointing at the same `/api/payment-webhook` URL, with a signing secret — can reuse the same secret string or pick a new one, just make sure it matches whatever you put in `LEMONSQUEEZY_WEBHOOK_SECRET`.
- [ ] Update Vercel's environment variables to the **live** values: `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_PRO_VARIANT_ID` (the new one from Copy to Live Mode), `LEMONSQUEEZY_WEBHOOK_SECRET` (matching the live webhook).
- [ ] Set `FREE_MONTHLY_LIMIT` back to its real value (`20`, or whatever you actually want) if you lowered it for testing.
- [ ] Do **one** real, small end-to-end purchase yourself with a real card to confirm live mode actually works — the test/live split in Lemon Squeezy means test-mode success doesn't automatically prove live mode is wired correctly (different API key, different webhook, different variant ID).
- [ ] Only after that real purchase completes and grants Pro access correctly: invite beta users.
