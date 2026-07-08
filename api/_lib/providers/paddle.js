// Paddle payment provider adapter — STUB, not yet implemented.
//
// This file exists to demonstrate that the provider abstraction is
// genuinely swappable, not just designed to look swappable: implementing
// this file with real Paddle logic (following the exact same two-function
// interface as api/_lib/providers/lemonsqueezy.js) and setting
// PAYMENT_PROVIDER=paddle is the entire migration — license-service.js,
// api/generate.js, api/create-checkout-session.js, and api/payment-webhook.js
// would all need zero changes.
//
// Paddle's actual integration shape (for whenever this gets built out):
// - Checkout: Paddle Billing uses client-side Paddle.js overlay/inline
//   checkouts rather than a server-created checkout URL the way Lemon
//   Squeezy and Stripe both work — createCheckoutUrl's return value would
//   likely need to become a set of parameters for the frontend to pass to
//   Paddle.js instead of a bare redirect URL, which is the one place this
//   interface might need a small extension when this is actually built.
// - Webhooks: Paddle signs requests via a "Paddle-Signature" header
//   (ts=...;h1=...), verified as HMAC-SHA256 over "{ts}:{rawBody}" using
//   the notification webhook secret — a different scheme from Lemon
//   Squeezy's, but the same category of thing (verify, then normalize).
//   Event names include subscription.created, subscription.updated (with
//   a status field), subscription.canceled, etc.

export async function createCheckoutUrl({ email, licenseKey }){
  throw new Error(
    'Paddle integration is not implemented yet. Set PAYMENT_PROVIDER=lemonsqueezy in the environment ' +
    'to use the real, working integration, or implement this file following the same interface as ' +
    'api/_lib/providers/lemonsqueezy.js.'
  );
}

export async function verifyAndNormalizeWebhook({ rawBody, headers }){
  throw new Error(
    'Paddle integration is not implemented yet. Set PAYMENT_PROVIDER=lemonsqueezy in the environment ' +
    'to use the real, working integration, or implement this file following the same interface as ' +
    'api/_lib/providers/lemonsqueezy.js.'
  );
}
