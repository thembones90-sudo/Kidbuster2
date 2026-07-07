# KIDBUSTER — Project Handoff / Context Document

This document summarizes everything built so far, the reasoning behind key decisions, and known open items. It's meant to give another AI (or another person) full context without needing the original conversation history. The actual working app is in `kidbuster.html` — a single self-contained HTML file.

---

## 1. What this is

KIDBUSTER is a single-purpose tool for an ESL teacher: paste a Krisp lesson transcript, pick a quality rating, optionally add a teacher note, click Generate, and get a polished parent/student feedback report that follows a strict internal template ("MA Protocol"). The report auto-copies to the clipboard.

**Core philosophy (explicitly stated by the product owner):**
> Should feel like using Google Translate. Open. Paste. Generate. Copy. Close. No unnecessary screens, no unnecessary clicks, no unnecessary complexity.
>
> Whenever making a design decision, ask: *Does this make it faster for a teacher who has another lesson starting in two minutes?* If the answer is no, it does not belong in the MVP.

**Explicit non-goals (do not add without a deliberate decision to change scope):**
- No student database
- No lesson planner
- No analytics
- No homework manager
- No CRM / parent portal
- No school management features
- No login/auth
- No subscriptions/monetization
- No history/logging of generated reports (one single-slot "previous report" recall is the only exception — see §5)

---

## 2. Architecture

**Current form factor:** one static HTML file (`kidbuster.html`), no build step, no backend. Runs directly in a browser or in an AI chat preview that can execute the embedded Claude API call.

**Why not a full app yet:** The product owner made a deliberate decision to defer building a real SaaS (React/TypeScript/Tailwind frontend + Node/Express or Next.js backend + Postgres + auth + Stripe) until the *workflow itself* is proven to save real time across genuine daily use (their stated target: 500–1000 real reports generated personally before considering other users or monetization). Building the full stack before that validation would be premature complexity.

**What *is* already built to make that future migration cheap:** the file is internally split into two layers:

- **`KidbusterCore`** (a single JS object/IIFE at the top of the `<script>` block) — pure, framework-agnostic business logic. Every function takes plain arguments and returns plain values; nothing in it touches `document`, `window`, `localStorage`, or the network. Contains:
  - `LEVELS` — the canonical 10-point rating scale
  - `LEVEL_TONE_DESC` — tone description per rating level
  - `MA_PARENT_NOTE_LEVELS` — which ratings trigger a "Parent Note" section
  - `MA_PROTOCOL_V2_1_SOURCE` — the verbatim, immutable protocol text (see §4)
  - `ratingColor(lvl)` — red→green→gold color mapping for the rating scale
  - `buildMASystemPrompt(params)` — builds the system prompt sent to Claude
  - `buildUserMessage(params)` — builds the user message sent to Claude
  - `analyzeMAOutput(text, lvl)` — validates generated output against protocol rules (see §6)

- **UI layer** (rest of the script) — DOM wiring only: reads form fields, calls `KidbusterCore` functions, writes results back to the page, manages the one network call (`callClaude()`), and handles browser-only concerns (clipboard, localStorage draft persistence).

**The one non-portable piece, flagged explicitly in a code comment:** `callClaude()` calls the Anthropic API directly from the browser. This only works because there is currently exactly one user and the API key is handled by the hosting chat environment. **This must move server-side (e.g. a Next.js API route) before any real multi-user deployment** — an API key shipped to the browser is public the moment it's exposed to more than one trusted person.

---

## 3. UI / UX as built

Single screen, dark theme (near-black background, neutral silver/gray surfaces and accents — not blue-tinted). Layout:

- **Left column:** Student name field, then the Quality Rating scale (10 always-colored buttons).
- **Right column:** Krisp Notes textarea (with a live word/character counter), Teacher Notes ("special remarks") textarea, Generate button, then the Output box with Copy / Clear / Regenerate buttons, an automatic validation panel, and a small "view previous report" recall link.

**Branding:** Header reads "KIDBUSTER" in a red-to-purple gradient (matching a supplied logo image, which is embedded in the file as a base64 PNG), all caps, with a small permanent "MA Protocol" badge next to it. Tagline: "Battle controls online."

**Removed during development (deliberately, not accidentally):**
- A "Free-form" generation mode (non-protocol tone-based generation) — the app now *only* does MA Protocol generation.
- Output length selector and a set of "extra option" checkboxes (grammar correction toggle, etc.) — these only applied to the removed free-form mode.
- A "Lesson topic" input field — removed because the model is instructed to infer the lesson topic directly from the transcript, making a separate field redundant extra typing.

---

## 4. The MA Protocol (V2.1) — the actual content spec

This is the single most important piece of domain content in the app. It is stored **verbatim, unedited** as a JS template string constant (`MA_PROTOCOL_V2_1_SOURCE`) and sent to Claude as the bulk of the system prompt for every generation. The product owner was explicit that this must never be summarized, paraphrased, or structurally modified by the AI — it's treated as immutable source text, not a starting point for rewriting.

Full text of the protocol as currently embedded:

```
MA PROTOCOL COMMAND CHAIN V2.1

When instructed to generate "MA", always produce the complete Master Protocol child feedback using the IMMUTABLE MA TEMPLATE exactly as defined below.

The MA Protocol is the highest-priority instruction for report generation. It must never be summarized, paraphrased, or structurally modified.

────────────────────────────────────────

LEVEL INTEGRATION
(Internal only. Never shown to parents.)

• 1/5 = Complete shambles. Firm, improvement-focused, strong parental guidance.
• 1.5/5 = Significant difficulties but genuine effort shown. Firm guidance with noticeable encouragement.
• 2/5 = Below expectations. Encouraging but clear about the need for effort.
• 2.5/5 = Improving but inconsistent. Balanced between constructive guidance and growing confidence.
• 3/5 = Neutral. Balanced, steady, light guidance.
• 3.5/5 = Mostly neutral with some warm praise.
• 4/5 = Better than expected. Warm, proud, highlighting growth.
• 4.5/5 = Mostly warm praise with touches of excellence.
• 5/5 = Excellent. Enthusiastic, glowing, joyful.
• 6/5 = Exceptional. Celebratory, awe-struck, highlighting mastery beyond expectations.

────────────────────────────────────────

UNIVERSAL RULES

Transcript Processing

• Ignore all transcript labels such as "Speaker", "Irrelevant", timestamps, transcript garbage, duplicated transcript lines, unfinished transcription fragments, filler recognition mistakes, and system-generated text.
• Use only meaningful lesson content when generating the report.

Formatting

• Never use bold text.
• Never use italics.
• Never use markdown formatting.
• Never use decorative symbols such as ⿡ ⿢ ⿣ ⿤ ⿥.
• Use only normal text and appropriate emojis.
• Preserve the exact section order of the template.

Content

• Always speak directly to the student.
• Always incorporate any additional Teacher Notes supplied by Layne. Teacher Notes always override transcript interpretation.
• Never invent lesson content, vocabulary, grammar, pronunciation issues or achievements that were not reasonably supported by the transcript or Teacher Notes.
• When information is uncertain, write conservatively rather than fabricating details.
• Keep vocabulary definitions short, simple and child-friendly.
• Keep observations based on actual student performance whenever possible.
• Match the writing tone precisely to the selected Level Integration score.

Template Rules

• Parent Note appears ONLY for ratings 1, 1.5, 2 and 2.5.
• Pronunciation Focus appears ONLY if pronunciation was meaningfully practiced or corrected.
• Include up to 10 vocabulary items. If fewer meaningful words were taught, include only those actually covered. Never invent vocabulary to fill empty slots.
• Include only grammar points genuinely covered during the lesson. Do not invent grammar topics simply to complete the template.
• Choose exactly one Today's Superpower.
• Every compliment should be supported by specific observations whenever possible.
• Mini Homework must contain exactly one mission:

* Vocabulary Mission
  OR
* Grammar Mission
  OR
* Speaking Mission
  • Total Stars Today must contain exactly 10 star emojis from the approved star collection.
  • End every report exactly with:

Cheers,
Teacher Layne 🐺

────────────────────────────────────────

IMMUTABLE MA TEMPLATE

Hi [Student Name]!

[Short positive opening about today's effort and lesson focus.]

Today's Lesson:
📚 [Lesson Topic]

Key Vocabulary with Pronunciation & Notes:

[Word 1] [Emoji] – [Short definition] | Pronunciation: [phonetic form] | Note: [observation]
[Word 2] [Emoji] – [Short definition] | Pronunciation: [phonetic form] | Note: [observation]
[Word 3] [Emoji] – [Short definition] | Pronunciation: [phonetic form] | Note: [observation]
[Word 4] [Emoji] – [Short definition] | Pronunciation: [phonetic form] | Note: [observation]
[Word 5] [Emoji] – [Short definition] | Pronunciation: [phonetic form] | Note: [observation]
[Word 6] [Emoji] – [Short definition] | Pronunciation: [phonetic form] | Note: [observation]
[Word 7] [Emoji] – [Short definition] | Pronunciation: [phonetic form] | Note: [observation]
[Word 8] [Emoji] – [Short definition] | Pronunciation: [phonetic form] | Note: [observation]
[Word 9] [Emoji] – [Short definition] | Pronunciation: [phonetic form] | Note: [observation]
[Word 10] [Emoji] – [Short definition] | Pronunciation: [phonetic form] | Note: [observation]

Pronunciation Focus: (optional)

🗣 [Word] → [Helpful pronunciation cue]
🗣 [Word] → [Helpful pronunciation cue]
🗣 [Word] → [Helpful pronunciation cue]

Grammar & Sentence Practice:

"[Example sentence 1]"
"[Example sentence 2]"
"[Example sentence 3]"

Grammar Points We Covered:

1. [Grammar Rule]
   👉 [Example sentence]
   👉 [Example sentence]

2. [Grammar Rule]
   👉 [Example sentence]
   👉 [Example sentence]

3. [Grammar Rule]
   👉 [Example sentence]
   👉 [Example sentence]

4. [Grammar Rule]
   👉 [Example sentence]
   👉 [Example sentence]

5. [Optional Grammar Rule]
   👉 [Example sentence]
   👉 [Example sentence]

Today's Superpower:
🦸 [Listening / Speaking / Reading / Pronunciation / Confidence / Teamwork / Focus / Creativity]

Positive Feedback:

[Detailed encouragement with specific examples from today's lesson.]

Parent Note: (Only for ratings 1, 1.5, 2 and 2.5)

[Constructive guidance for parents regarding focus, participation, preparation or support.]

Mini Homework:

Choose exactly one:

Vocabulary Mission 🎯
[Task]

OR

Grammar Mission 🎯
[Task]

OR

Speaking Mission 🎯
[Task]

Total Stars Today:

[Exactly 10 approved star emojis]

[Positive closing sentence.]

Cheers,
Teacher Layne 🐺

────────────────────────────────────────

VALIDATION CHECKLIST
(Internal only. Never displayed.)

Before returning the report, verify:

✓ Correct rating tone applied.
✓ Template order preserved.
✓ Teacher Notes incorporated.
✓ Transcript cleaned.
✓ No invented lesson content.
✓ Parent Note only for ratings 1–2.5.
✓ Exactly one Superpower selected.
✓ Exactly one Homework Mission selected.
✓ Exactly 10 star emojis displayed.
✓ No markdown formatting.
✓ Closing exactly matches the protocol.
```

**At generation time**, the app appends a short, separate "runtime parameters" block after this text — it does not alter the protocol, it just tells the model which rating applies to *this specific* report (since that's the one value that changes call to call):

```
RUNTIME PARAMETERS FOR THIS REPORT (computed from the app, not part of the protocol text above — apply the protocol's rules using these exact values):
- Selected rating: {rating}/5.
- Tone for this rating per the Level Integration table: {tone description}
- Parent Note for this report: INCLUDE it / OMIT it entirely (computed from the rating)
```

---

## 5. Features currently implemented

- **10-point rating scale**: 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6 — all first-class values, half-points are never rounded, model is explicitly told to blend tone naturally at half-points rather than defaulting to a neighbor.
- **Always-visible color coding**: red → green across 1–5, with 6 rendered in gold as a visually distinct "beyond expectations" tier (bordered, slightly scaled, marked with a star glyph).
- **Auto-clear**: the Krisp Notes field empties itself after a successful generation, ready for the next lesson.
- **Auto-copy**: successful generation copies the report to the clipboard automatically, no click needed.
- **Robust clipboard handling**: tries the modern Clipboard API first, falls back to a hidden-textarea `execCommand('copy')` if that's blocked (common in sandboxed preview environments), and as a last resort auto-selects the output text so a manual Ctrl+C/Cmd+C works.
- **One-slot "previous report" recall**: after a second generation, a small toggle lets you glance back at the previous report (with its own validation results). Not a history list — one slot only, in-memory, cleared on page refresh or Clear.
- **Draft persistence**: student name, Krisp notes, teacher notes, and selected rating are saved to `localStorage` as you type and restored on reload. Explicitly *not* a report history — only the current unsaved form state.
- **Live word/character counter** on Krisp Notes, turning amber below ~15 words as a signal the transcript may be too thin to generate a real report from.
- **Distinct API error messages** — rate-limited, overloaded, server error, network failure, and auth problems each get a different, actionable message rather than a generic failure string.

---

## 6. Automatic output validation ("lint")

After every generation (and regeneration), `KidbusterCore.analyzeMAOutput(text, rating)` runs a set of regex-based checks against the raw output and displays either a green "passed" note or a list of specific warnings under the output box. This is **pattern-matching, not semantic judgment** — it catches mechanical rule violations, not content quality.

Checks currently implemented:
1. **Star count** — exactly 10 star emojis (`⭐🌟✨💫🌠`) required.
2. **Bold text** — flags `**text**` / `__text__` patterns.
3. **Italic text** — flags single `*text*` / `_text_` patterns (careful to not double-match bold pairs).
4. **Other markdown** — headings (`#`), inline code (`` `code` ``), and markdown links.
5. **Parent Note gating** — flags if present when it shouldn't be (rating > 2.5) or missing when required (rating ≤ 2.5).
6. **Exactly one Superpower** — counts `🦸` occurrences.
7. **Exactly one homework mission** — checks that exactly one of "Vocabulary Mission" / "Grammar Mission" / "Speaking Mission" appears.
8. **Exact sign-off** — checks the output ends with `Cheers, / Teacher Layne 🐺` exactly.

**Known limitations of this validation (documented, not hidden):**
- Star regex is a fixed character set — an unusual star variant/emoji would not be counted.
- Bold/italic regex requires the marked span to not contain a newline; a bolded phrase spanning a line break wouldn't be caught (unlikely in practice, not impossible).
- Nothing checks vocabulary/grammar *quality*, whether content is actually age-appropriate, or whether the tone genuinely matches the rating — that remains a human judgment call during the field test.

---

## 7. Reliability engineering already done

- Full test file was sandbox-executed in Node (extracting `KidbusterCore` and running it standalone) against a hand-built well-formed sample report and three deliberately broken variants (bold injected, italics injected, wrong-rating Parent Note) — all four cases were flagged correctly with no false positives.
- Font loading was trimmed to only the weights actually used in CSS (previously requesting 9 weight/family combinations, most unused; now 5), incidentally fixing a rendering bug where bold rating numbers (weight 700) were being faked by the browser because weight 700 was never actually being loaded.
- Copy-to-clipboard was hardened with a three-tier fallback (see §5) after the original Clipboard-API-only version silently failed inside a sandboxed preview iframe.

---

## 8. Field testing status (as of this handoff)

The product owner ran a field-test plan: 5 real Krisp transcripts across a spread of ratings (one low, one neutral, one ~4–4.5, one 5, one deliberately messy transcript), checking for: protocol adherence, Teacher Notes respected, no invented content, correct tone per rating, useful vocabulary, realistic grammar section, appropriate homework, and time saved vs. ChatGPT.

**Result reported so far:** "Test turned out perfect" (their words) on the run(s) completed. Explicit agreed next step was to run it across the full range of ratings (not just the one tested) before drawing broader conclusions, since a 6/5 and a 1.5/5 exercise very different parts of the tone system and Parent Note logic. Whether the remaining spread has been tested is not yet reported back to me.

---

## 9. Open items / things worth a second opinion

These are the honest gaps as I see them — good candidates for ChatGPT (or anyone else) to sanity-check or challenge:

1. **Single point of failure on the API key.** Fine for solo daily use right now; will need a real backend before this can ever be shared with another teacher. No timeline decision has been made on this yet — deliberately deferred.
2. **No automated regression tests live in the file itself.** Validation logic has been manually sandbox-tested by me during development, but there's no way to quickly re-verify `analyzeMAOutput` still behaves correctly if the protocol changes again, short of manually re-running that test.
3. **The "approved star collection" mentioned in the protocol text is never actually defined anywhere** — the model is just told to use star emojis, and the validator counts any of 5 common ones. If there's a real approved list, it hasn't been specified to me.
4. **No handling for partial/truncated API responses** beyond a generic "empty response" check — a response that's valid JSON but visibly cut off mid-report wouldn't be caught by validation beyond whatever rule it happens to violate (e.g. missing sign-off would catch a truncated ending, but a truncated middle section might not trip any specific check).
5. **Color accessibility** hasn't been checked — the red→green rating scale in particular may be hard to distinguish for colorblind users, and there's no non-color indicator of position on the scale besides the number itself (which is legible, but worth flagging).
6. **The document you're reading now, plus the HTML file, is the entire spec.** There is no separate written product requirements document beyond what the product owner has stated conversationally over the course of building this — if ChatGPT proposes changes, cross-check them against the "explicit non-goals" in §1 before implementing, since scope discipline has been a repeated, deliberate theme throughout this project.

---

## 10. The file itself

The complete, current, working app is `kidbuster.html` (single file, ~1160 lines, no dependencies beyond a Google Fonts CDN request and the Anthropic API endpoint at generation time). It should be sent alongside this document — this document provides context and history; the HTML file is the actual thing to review or modify.
