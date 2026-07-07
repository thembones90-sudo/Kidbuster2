# KIDBUSTER — Field Test Log

Tracks issues encountered during real daily use across **both** official protocols. Exists only to detect patterns — not a to-do list, not a feature backlog.

Protocol is a variable in the test, not a separate QA project. MA and OF share one log, one set of rules, one Three Occurrence Rule — because the point of tracking is to tell engine problems apart from protocol-specific ones, and that distinction only shows up if both protocols are visible in the same table.

---

## How to read this log

**One row per occurrence.** When the same issue happens again, add a new dated row — don't edit an old row's fields in place. The whole point of a searchable table is that you can literally scan for repeated `Issue` text and count how many times it shows up, rather than trusting a hand-maintained counter to have been updated correctly every time.

**Category** — one of:
- **ENGINE** — shared generation, UI, export, or transcript-cleaning issues (anything in the shared engine, not protocol-specific text)
- **MA** — MA-specific prompt or validator behavior
- **OF** — OF-specific prompt or validator behavior
- **UX** — workflow or usability observations, independent of protocol

**Three Occurrence Rule, scoped by Category:**
- Same `Issue` + same Category, 3 times → that protocol's prompt or validator has a real problem. Eligible for engineering work — see DECISIONS.md.
- Same `Issue` appearing under **both** MA and OF → don't wait for three. Two independent protocols hitting the same symptom points at the shared engine, not either protocol's text — treat it as higher-priority than a single-protocol pattern, even on a 2nd occurrence.
- 1st occurrence of anything → Observe only. No action, no theorizing about root cause yet.

**Prompt Version** — record the exact version string in play at the time, matching the code constant (currently `MA_PROTOCOL_V2_1_SOURCE` → **MA 2.1**, `OF_PROTOCOL_V1_SOURCE` → **OF 1.0**). This is what makes it possible to tell, months from now, whether a regression was introduced by a version bump — instead of relying on memory, which has a well-documented track record of confidently lying to people.

**Validator** — what `analyze()` actually returned: `Pass` (empty array) or a short summary of the warning(s) it raised. This is Facts, not judgment — copy what the validator said, don't paraphrase it into an opinion.

**Result** — `Pass` / `Needs edit` / `Fail`, your own read on whether the report was usable as generated, which may legitimately differ from what Validator says (e.g. validator passes but the tone felt wrong; or validator warns on something you judge a non-issue in this case).

---

## Log

| Date | Student | Protocol | Prompt Version | Validator | Result | Category | Issue | Action |
|------|---------|----------|-----------------|-----------|--------|----------|-------|--------|
| 2026-07-05 | James | MA | MA 2.1 | Pass (no length check existed yet) | Fail (undeliverable) | MA | Report was 5,232 characters — exceeds platform's 5000-char comment limit by 232 chars, no MA length constraint existed | Fixed same day → MA 2.2, see DECISIONS.md |

<!--
Row template — copy one line per occurrence:
| YYYY-MM-DD | Name | MA/OF | MA 2.1 / OF 1.0 | Pass / warning summary | Pass / Needs edit / Fail | ENGINE/MA/OF/UX | Short issue description | None yet / Observe / Monitor / see DECISIONS.md |
-->

---

## Patterns crossing the 3-occurrence threshold (or 2+ across both protocols)

*(populate once any Issue+Category combination reaches the relevant threshold — link to the corresponding DECISIONS.md entry once acted on)*

---

## Example rows (for format reference only — delete once real entries begin)

| Date | Student | Protocol | Prompt Version | Validator | Result | Category | Issue | Action |
|------|---------|----------|-----------------|-----------|--------|----------|-------|--------|
| 2026-07-10 | Ana | MA | MA 2.1 | Pass | Needs edit | MA | Homework too difficult for A1-level student | Observe (1st) |
| 2026-07-14 | Marko | MA | MA 2.1 | Pass | Needs edit | MA | Homework too difficult for A1-level student | Monitor (2nd) |
| 2026-07-19 | Ivan | MA | MA 2.1 | Pass | Needs edit | MA | Homework too difficult for A1-level student | Evidence (3rd) → review protocol, see DECISIONS.md |
| 2026-07-21 | Petra | OF | OF 1.0 | Missing required section(s): Confidence | Fail | OF | Confidence section occasionally dropped by the model | Observe (1st) |
