# Kidbuster

ESL teacher parent-feedback generator — MA Protocol (regular lessons) and OF Protocol (trial-lesson narratives), built on a shared Judgment Engine.

## Architecture

```
Browser (index.html)  →  /api/generate  (Vercel serverless function)  →  Anthropic API
     all UI, protocols,        the ONLY place the real API key
     validators, KidbusterCore  exists — never sent to the browser
```

- **`index.html`** — the entire app: UI, MA/OF protocol text, validators, ProtocolManager. Runs entirely in the browser. Contains zero secrets.
- **`api/generate.js`** — a single serverless function. Receives an already-built system prompt + user message, attaches the real Anthropic API key server-side, calls Anthropic, returns the result. Has no knowledge of protocols, MA, OF, or validation — that's deliberate. It is a thin, dumb proxy on purpose, so all the actual product logic stays in one place (the frontend), the same way it always has.

## What changed from the old single-file version, and why

1. **The API key moved server-side.** The old version called Anthropic directly from the browser with no key at all — it only worked inside Claude's own artifact environment, which transparently proxies those calls. Opened anywhere else (a real deployed site), that call would simply fail, and even if a key were added, browsers can't call Anthropic's API directly (CORS blocks it) — exposing a key in browser code would also be a real security problem the moment this is shared with anyone else.
2. **A shared access-key gate was added, then later replaced entirely.** Hiding the key alone isn't enough — a public URL with no protection at all could be found and used by strangers to spend your API budget. `APP_ACCESS_KEY` started as a simple shared password, not real per-user authentication — fine for a two-person test, but it couldn't distinguish who was using the app or cap anyone's usage. It's since been replaced by real per-teacher license keys (Free/Pro plans, usage tracked per license in Vercel KV) — see "Monetization" below. The `x-app-key` header the frontend already sent is the same mechanism; only what that header *means* changed.
3. **Teacher identity is now a field in the app, not hardcoded text.** Both protocols previously hardcoded "Teacher Layne" in the sign-off. There's now a **Teacher** field in the UI (defaults to "Layne", so nothing changes for your own use unless you type something else). It's substituted into the prompt before sending, and the validator checks the sign-off against whatever name was actually used — tested to confirm it's fully backward-compatible with existing behavior when left as "Layne".
4. **Nothing else changed.** MA Protocol, OF Protocol, the ProtocolManager registry, both validators, the rating tracks, the UI, the whole generation flow — byte-for-byte the same logic, just reading from a different endpoint for the actual API call.

## Deploying it

### 1. Push this to GitHub (if not already done)
```bash
git add .
git commit -m "Add secure backend, ready for deployment"
git push
```

### 2. Connect to Vercel
1. Go to [vercel.com](https://vercel.com), sign in (GitHub login is easiest).
2. **Add New → Project**, select your Kidbuster repository.
3. Vercel will auto-detect this as a static project with serverless functions — no build settings need to be changed. Don't set a build command or output directory; leave them blank/default.

### 3. Connect Vercel KV (required — this is where license/usage data lives)
1. In your Vercel project, go to **Storage → Create Database → KV**.
2. Follow the prompts to connect it to this project. Vercel automatically sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you — you don't need to enter those yourself.

### 4. Set up Lemon Squeezy (the payment provider — see "Monetization" below for the full picture)
1. Create an account at [lemonsqueezy.com](https://lemonsqueezy.com) if you don't have one — this works from Serbia and most other countries Stripe doesn't cover.
2. Create a **Pro** subscription product (whatever monthly price you want). Note its **Variant ID** (visible on the product's variant page).
3. Go to **Settings → API** and create an API key. Note your **Store ID** too (visible in store settings).
4. Go to **Settings → Webhooks**, add a webhook pointed at `https://yourdomain.vercel.app/api/payment-webhook`, subscribed to at minimum: `subscription_created`, `subscription_payment_success`, `subscription_cancelled`, `subscription_expired`. Lemon Squeezy doesn't generate a signing secret for you — type any random string yourself (6-40 characters) as the secret; you'll enter this same string in Vercel's env vars next.

### 5. Set environment variables
Go to **Project Settings → Environment Variables** and add everything from `.env.example` — see that file for what each one does and where to find its value. At minimum you need: `ANTHROPIC_API_KEY`, `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_PRO_VARIANT_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`, and `SITE_URL`.

### 6. Deploy
Click **Deploy**. Vercel gives you a URL like `https://kidbuster-yourname.vercel.app` — this is the real, live, shareable app.

## Monetization: Free vs Pro

Two plans, nothing more granular:

- **Free** — 20 report generations/month (configurable via `FREE_MONTHLY_LIMIT`), Classic (MA) protocol only.
- **Pro** — flat monthly subscription, unlimited reports, every protocol, automatic access to future ones too.

The architecture is deliberately payment-provider-agnostic:

```
Payment Provider  →  License Service  →  Kidbuster
```

`api/_lib/license-service.js` is the only thing that knows how to create, upgrade, downgrade, or check a license — it has zero knowledge of Lemon Squeezy, Paddle, or any other provider. Each payment provider's *only* job (see `api/_lib/providers/`) is to normalize its own webhook events into four plain notifications: payment succeeded, subscription renewed, subscription canceled, subscription expired. `api/generate.js` never imports a payment provider at all — it only ever talks to the License Service.

Lemon Squeezy is the one fully-implemented provider today; Paddle exists as a documented stub in `api/_lib/providers/paddle.js` showing the same interface, for whenever that's worth building out. Swapping providers means writing one new file in `api/_lib/providers/` and changing the `PAYMENT_PROVIDER` env var — nothing in the License Service, `api/generate.js`, or any other route needs to change.

A teacher gets a Free key via the in-app "Get my free key" flow (email only, no payment) or upgrades to Pro via a real checkout with whichever provider is active — both paths land on the same personal license key, which replaces the old single shared team password (`APP_ACCESS_KEY`) entirely.

## How a teacher uses it

1. Open the URL you send them in any browser, on their own computer. No Claude, no API key, no development environment, no GitHub account needed.
2. The first time they generate a report, they're prompted to either get a Free key (just an email — no payment) or enter an existing one. That's stored in their browser going forward.
3. They set the **Teacher** field to their own name (once — it's remembered afterward).
4. Everything else is identical to how you use it: pick a protocol, pick a rating, paste notes, click Generate.

Free comes with the same real limits everyone gets: 20 reports/month, Classic protocol only. Upgrading to Pro (unlimited, every protocol) is a button click away, handled entirely by the payment provider's own hosted checkout — no card details ever touch this app.

## Field-test feedback system

After every generated report, an inline card appears (not a modal, not mandatory) letting a teacher tap 1-5 stars and optionally leave a short comment on how good *that report* was — not a rating of the student or lesson. Clicking a star submits immediately; typing a comment first includes it in that same submission.

This is deliberately separate from the app's own localStorage stats (`kidbusterStats()`) — feedback needs to be visible to you centrally, not trapped in each teacher's browser, so it's sent to `/api/feedback`, which forwards it to a Google Sheet.

**One-time setup**, in addition to the steps above:
1. Follow the setup instructions at the top of `google-apps-script.js` — create a Google Sheet, paste that script into its Apps Script editor, deploy it as a Web App, and copy the resulting URL.
2. Add `GOOGLE_SHEET_WEBHOOK_URL` to Vercel's environment variables with that URL.

Every submission appends one row: timestamp, teacher name, protocol, rating tier, score, comment. If this variable isn't set, the feedback card still appears but shows "Could not send feedback" on submission — the report itself is never affected either way.

Currently shows after every generation, by design, since field-test volume is low and the priority is signal over politeness. Worth throttling (e.g. every 5th generation) if it ever starts to feel like nagging — that's a one-line change whenever it's warranted, not before.

## Your workflow after every future update

1. Make changes to `index.html` (or `api/generate.js`) locally, same as always.
2. `git add . && git commit -m "describe the change" && git push`
3. That's it. Vercel is watching your GitHub repo — every push to the main branch automatically triggers a new deployment, live within about a minute, at the same URL.
4. Nina doesn't do anything. She just refreshes the page next time she opens it and gets the newest version automatically. There's no separate "send Nina the update" step.

## Automated tests

```bash
npm test
```

Runs a suite of automated checks (`tests/`) directly against the real logic in `index.html` — not a hand-maintained copy that could drift out of sync. It covers things like: the Short/Medium/Long length tiers hit the right character targets, the wolf-emoji sign-off only appears for Teacher Layne, Blitz's shuffle bag actually uses all 10 writing models before repeating, and the usage-stats tracker doesn't crash for any registered protocol (this last one exists because it actually broke once, when Blitz was added — see `tests/README.md`).

If you add a new protocol or a meaningfully new rule to an existing one, add a test for it in `tests/` — `tests/README.md` explains the pattern and why it's built this way (spoiler: it extracts `KidbusterCore` straight out of this very file at test time, so it's testing what's actually here, not a snapshot).

## Local testing before deploying (optional)

If you want to test changes before pushing, install the Vercel CLI:
```bash
npm install -g vercel
vercel dev
```
This runs both the static frontend and the serverless function locally, using a `.env` file (copy `.env.example` to `.env` and fill in real values — `.env` is already gitignored, so it will never be committed).

## Known limitations, on purpose

- **Paddle is a documented stub, not a real integration.** `api/_lib/providers/paddle.js` implements the same interface as the Lemon Squeezy adapter but throws "not implemented" — it exists to prove the payment-provider abstraction is genuinely swappable, not to be used yet. Build it out (and flip `PAYMENT_PROVIDER=paddle`) whenever there's an actual reason to switch providers.
- **No self-service billing portal.** A Pro subscriber can't currently view/cancel their own subscription from inside this app — that lives entirely on Lemon Squeezy's own hosted pages (which do have this), reached via the email receipt Lemon Squeezy sends, not a link inside Kidbuster itself.
- **Cancellation and expiration currently have identical effects** (both immediately fall back to Free) — there's no grace period modeled between "canceled, but paid through end of period" and "access actually ends." Simple on purpose, matching the product's own "just Free and Pro, nothing fancier" philosophy; worth revisiting if it ever actually annoys a real subscriber.
- **Model, max_tokens, and API version are fixed server-side** in `api/generate.js` rather than sent from the browser — this is a deliberate security choice, not an oversight, so a request from the browser can't override which model gets called or its parameters.
