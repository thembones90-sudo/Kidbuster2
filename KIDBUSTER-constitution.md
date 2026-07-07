# KIDBUSTER — Product Constitution

Final version, agreed after architecture discussion. This is the governing philosophy for all future engineering and product decisions. It supersedes informal reasoning in prior conversations — when in doubt, this document is the source of truth.

---

## Article Zero — Why KIDBUSTER Exists

**KIDBUSTER exists to save teachers time without reducing professional quality.**

Every feature, protocol change, validation rule, and engineering decision must support this objective. If a proposal makes the software more complicated without measurably reducing teacher workload or improving report quality, it does not belong in KIDBUSTER.

This is the north star of the project. The Four Founding Statements below explain *how* KIDBUSTER works. Article Zero explains *why* it exists. Every other article in this document is in service of this one.

One further consequence of Article Zero, made explicit: **KIDBUSTER is a judgment engine, not an AI application, a Claude wrapper, or a prompt editor.** Claude is today's reasoning engine — replaceable, if a better one exists tomorrow, without changing the product's philosophy. What is not replaceable is the workflow, the protocol, and the trust built through its consistent use. Those are the actual asset. Any future engineering decision should be evaluated against this: does it strengthen the workflow/protocol/trust, or does it merely change which model produces the text.

---

## The Four Founding Statements

1. **Facts are deterministic.**
2. **Judgment is centralized.**
3. **Judgment evolves through evidence.**
4. **Trust is the product.**

Everything below is elaboration of these four statements. Any future decision should be traceable to one of them.

---

## The General Principle: Facts vs. Judgment

This is the fundamental engineering rule, replacing the earlier "Identity vs. Protocol" framing once it became clear Identity was a special case of something broader.

**Any deterministic fact, regardless of scope, is inserted by `KidbusterCore` before prompt construction. It is never phrased to the model as an instruction, and the model never decides it.**

Facts, by scope:

- **Per-report facts:** Student Name, Rating, Lesson Topic, Transcript, Teacher Notes
- **Per-teacher facts:** Teacher Name, Sign-off, Sign-off Emoji
- **Future account facts:** School Name, School Logo, Country, Timezone

Mechanism: the protocol source text contains placeholder tokens (e.g. `{{TEACHER_NAME}}`, `{{TEACHER_EMOJI}}`). `KidbusterCore` performs deterministic string replacement on these tokens before the prompt is sent to Claude. The model never sees a choice about facts — it only ever sees the already-correct, fully-substituted text. This applies retroactively to any existing hardcoded reference (e.g. "Teacher Notes supplied by Layne" must become "Teacher Notes supplied by {{TEACHER_NAME}}" before this is usable by a second teacher).

**The AI only ever performs judgment. It never performs fact-selection.**

---

## Layer 2: Judgment (Locked)

Judgment is the product. It belongs to KIDBUSTER, not the teacher, and is not configurable in Phase 1 (or until the Signal Rule below is triggered).

Contents of the judgment layer:
- MA Protocol (report structure, tone mapping)
- Validation rules
- Vocabulary logic
- Homework logic
- Parent Note rules
- Anti-fabrication rules
- Protocol reasoning generally

This is the competitive advantage. Teachers pay for trusted judgment, not for a prompt editor. No protocol editor, tone editor, vocabulary-count editor, homework editor, section editor, or prompt editor will be built in Phase 1.

---

## Layer 3: Versioning (Central, Evidence-Driven)

Judgment can evolve — but only through official, named, immutable protocol versions (e.g. MA Protocol V2.2, V2.3, V3.0), never through per-teacher preference.

**Protocol Evolution Rule** — a version update requires evidence:
- Repeated hallucinations
- Repeated vocabulary padding
- Repeated grammar mistakes
- Demonstrated prompt or workflow improvements

It does **not** happen because of individual preference ("I personally prefer..."). Preference is not protocol evidence.

**Versioning is immutable and archival, not a living document:**
- Every protocol version remains archived, never deleted.
- If a new version regresses (introduces new failure patterns), the fix is to **roll back to the prior version**, not hot-patch the current one under pressure.
- Versioning should feel like software releases. Old versions are superseded, not erased.
- Updates apply centrally and simultaneously to every user. Nobody is ever on a "personal fork" of the protocol.

**Language is presentation, not a protocol fork.** The default assumption is one universal judgment engine, expressed in different languages as a deterministic output parameter — not separate "English judgment" and "German judgment." The same transcript should produce the same underlying observations, praise, and homework reasoning regardless of output language; only the language changes. This default can be revisited only if field evidence demonstrates that a specific language genuinely requires different educational conventions, not on assumption.

---

## The Signal Rule (When Customization May Be Considered)

Protocol-level customization is only considered when: **three or more unrelated paying teachers independently request the same structural capability.**

One request is feedback. Three independent requests are product data.

Before a request counts toward that threshold, apply two filters, in order:

1. **Is this already solved by the Identity/Fact layer?**
   Example: "Can I change my sign-off?" → Identity. Does not count.

2. **Is this already solvable via Teacher Notes on a per-report basis?**
   Example: "I want fewer grammar points for weaker students" → likely already achievable by writing "keep grammar brief today" in Teacher Notes. Does not count unless proven otherwise.

Only requests that survive both filters — genuine structural asks like a different vocabulary structure, a different homework philosophy, a different grammar presentation style, or a different report structure — accumulate toward the three-teacher bar.

---

## Responsibility and Trust

Because judgment is intentionally centralized and locked, **every generated report represents KIDBUSTER's judgment, not the teacher's configuration.** There is no "the user set it up wrong" excuse available, because there is no setup to blame.

Consequences of this:
- Validation (the automated lint/checks layer) is not a convenience feature. It is part of the product promise.
- Every improvement to validation directly increases trust.
- Trust — not AI, not prompts, not Claude access — is what is being sold.

---

## Product Positioning

We are not selling prompts. We are not selling Claude. We are not selling AI.

**We are selling trusted judgment.** The protocol is teaching experience, refined through real classroom iteration, encoded into software. That accumulated experience — not prompt secrecy — is the actual moat. The moat is: hundreds of real classroom iterations, edge-case handling already solved, workflow speed, and consistency — not the wording of the prompt, which any competitor could eventually infer from output alone.

---

## Engineering Rule

Whenever making a technical decision, determine first which layer it belongs to:

- **Fact** → simple deterministic data, substituted by code, never phrased as an instruction to the AI.
- **Judgment** → protocol logic. Locked. Only changes via a new archived version.
- **Versioning** → central improvement, evidence-driven, applied equally to every user, never fragmented per-user.

If a proposed change doesn't obviously belong to one of these three, that ambiguity itself is a signal to pause and classify it deliberately — as was done with output language — rather than build first and categorize later.

---

## Status

This constitution is complete. Article Zero establishes why KIDBUSTER exists; the Four Founding Statements and the layer architecture (Facts / Judgment / Versioning) establish how it works. Together they are the final architecture decision before returning to build mode — this document is now the standing reference for any future engineering or product question, not a topic for further debate.

The next source of truth is not further design discussion — it is **100 real lessons.** Findings from that field test (report quality, speed, repeated failures, teacher friction) are what will validate or revise anything above, not further speculation.
