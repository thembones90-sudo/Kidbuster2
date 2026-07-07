// Kidbuster secure backend proxy.
//
// This is the ONLY place the real Anthropic API key ever exists. It lives
// in a Vercel environment variable, never in git, never in the browser.
// The frontend (index.html) sends a fully-built systemPrompt + userMessage
// here; this function attaches the real API key server-side, calls
// Anthropic, and relays the result back. It has zero knowledge of MA/OF,
// protocols, or validation — that logic stays entirely in KidbusterCore on
// the frontend. This function's only job is: authenticate the request,
// hide the key, proxy the call.
//
// Prompt caching: every protocol's buildXSystemPrompt() (see KidbusterCore
// in index.html) assembles its prompt as
//   <large, static protocol text> + '\n\n────────────────────────────────────────\n\n' + <small, per-request runtime params>
// — the same divider MA/Sugarcoat/OF's own internal sections already use,
// so it can appear multiple times; the LAST occurrence is always the one
// separating the static bulk from the small per-generation tail (rating-
// specific tone, length-tier target, etc). Splitting on that lets the
// large, genuinely-repeated part (thousands of words, identical across
// every generation for the same teacher+protocol) be marked cacheable,
// while the small part that actually changes every request stays outside
// the cache. Blitz doesn't use this divider (its variation — which of 10
// writing models got picked — is threaded through the middle of its text,
// not appended as a tail), so for Blitz the whole prompt is cached as one
// block instead — still a real win whenever the same teacher gets the
// same model again from the shuffle bag.
const SYSTEM_PROMPT_DIVIDER = '\n\n────────────────────────────────────────\n\n';

function buildCacheableSystemBlocks(systemPrompt) {
  const splitIdx = systemPrompt.lastIndexOf(SYSTEM_PROMPT_DIVIDER);
  if (splitIdx === -1) {
    // No divider found (e.g. Blitz) — cache the whole thing as one block.
    return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
  }
  const staticPart = systemPrompt.slice(0, splitIdx);
  const dynamicTail = systemPrompt.slice(splitIdx); // includes the divider itself
  return [
    { type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicTail }
  ];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- lightweight shared-secret gate ---
  // Not a real auth system — no accounts, no per-user identity. Just
  // enough to stop a bare public URL from being freely usable by anyone
  // who stumbles on it. Set APP_ACCESS_KEY in Vercel's environment
  // variables; the frontend prompts the user for this once and remembers
  // it in localStorage.
  const expectedKey = process.env.APP_ACCESS_KEY;
  if (expectedKey) {
    const providedKey = req.headers['x-app-key'];
    if (providedKey !== expectedKey) {
      return res.status(401).json({ error: 'Invalid or missing access key' });
    }
  }

  const { systemPrompt, userMessage } = req.body || {};
  if (!systemPrompt || typeof systemPrompt !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid systemPrompt' });
  }
  if (!userMessage || typeof userMessage !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid userMessage' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set in the environment');
    return res.status(500).json({ error: 'Server is not configured correctly (missing API key)' });
  }

  let anthropicResponse;
  try {
    anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: buildCacheableSystemBlocks(systemPrompt),
        messages: [{ role: 'user', content: userMessage }]
      })
    });
  } catch (networkErr) {
    return res.status(502).json({ error: 'Network error contacting Anthropic' });
  }

  if (!anthropicResponse.ok) {
    let detail = '';
    try {
      const errBody = await anthropicResponse.json();
      detail = (errBody && errBody.error && errBody.error.message) || '';
    } catch (e) { /* body wasn't JSON, ignore */ }
    return res.status(anthropicResponse.status).json({
      error: detail || ('Anthropic API request failed with status ' + anthropicResponse.status)
    });
  }

  const data = await anthropicResponse.json();
  const text = (data.content || []).map(b => b.text || '').join('').trim();

  if (!text) {
    return res.status(502).json({ error: 'Anthropic returned an empty response' });
  }

  // data.usage now includes cache_creation_input_tokens / cache_read_input_tokens
  // whenever caching was actually used — forwarded through as-is so the
  // frontend's cost tracker (see kidbusterStats() in index.html) can price
  // each token type correctly instead of treating everything as a normal
  // input token.
  return res.status(200).json({ text, usage: data.usage || null });
}
