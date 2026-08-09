# Notes on writer-prompt.md

Kept separate so `writer-prompt.md` can be sent verbatim as the system prompt with no meta-text in it.

## What each part is doing

**"The order of your output is a safety mechanism."** This restates in prose what `ORDERED_GENERATION_SCHEMA` already enforces structurally. Belt and braces: the schema guarantees the *fields* arrive in gate-first order, and the prose is there so the model actually *decides* in that order rather than writing four beats and then back-filling `skip` to match. Those are different failures and only the second one is prompt-addressable.

**The filler beats on skip.** The schema requires exactly four beats even when `skip` is true, because structured output cannot make a field conditional. Lane C's parser never touches them — `parseGateBeforeBeats` returns before `fields[4]` is read, which is the safety boundary. But the raw model output still transits the server as a string, so requiring constant `"skipped"` filler means no observation about a protected-category visitor is ever *written down anywhere*, not even in a string that gets discarded. That is stricter than the spec asks for and costs nothing.

**"Skipping is not a failure and it costs nothing."** Deliberate. Models under-use a branch that reads as giving up, and the skip branch here is the boring one — no jokes to write. Framing it as a correct outcome with a fallback already queued is the difference between a gate that fires and a gate that rationalises.

**The allusion section.** This is the single most important passage in the file. The spec (§4) is explicit that the one-call architecture's failure mode is not naming the mobility aid but gesturing at it, and that a machine being coy about a stranger's body is *worse* than one being tactless. Three concrete examples beat any amount of instruction here, because the failure is a register rather than a word.

**Two-tier structure: skip vs never-mention.** The spec has this implicitly — mobility aids are a skip condition (§4) while body size is a tone rule (§4) — but never names the distinction. Naming it prevents two opposite errors: skipping every visitor with a tattoo (which would starve the piece), and writing around a mobility aid because it "wasn't on the tone list". The rule that closes the gap is *if the only interesting thing is on the never-mention list, skip anyway* — without it, "never mention it" and "write four beats" combine into exactly the coy allusion we are trying to prevent.

**"Everything either screen says is on a wall, at head height, in a public room."** Last line on purpose. It is the only sentence that describes the actual stakes, and it does more work than another rule would.

## Added beyond the spec's enumerated list

Three additions to the skip conditions, all in the same direction (more conservative), flagged here so they are deliberate rather than accidental:

- **Anyone who reads as a child.** Covered by "anything reading as a protected category" but worth naming. A gallery piece roasting an eight-year-old is the same bad write-up by a different route.
- **Visible pregnancy.** Body commentary and protected category at once.
- **Clothing text that is political, religious, medical, memorial, or names an employer or school.** Reading a slogan aloud is otherwise good material — this is the narrow carve-out. The charity-run t-shirt is the likeliest real-world miss in the whole set, because it looks exactly like an ordinary graphic tee.

## Tuning levers, in the order to reach for them

1. **Tone examples.** The `"Every item you're wearing is black…"` / `"Those shoes look cheap"` pair is doing more work than any rule in the file. If the roast lands wrong, replace or add to that pair before adding a rule — the model matches examples much harder than instructions.
2. **The 8–15 word range.** Tightening to 8–12 makes the whole reveal faster and the jokes harder; widening past 15 blows the 18–25 second reveal budget (§4). Do not widen it to fix a beat that just needs rewriting.
3. **Roast-last ratio.** Stated as "roughly seven in ten", decided per-performance by which screen opens. There is no cross-call memory, so this is a tendency, not a guarantee. If the real distribution comes out badly skewed, that is a signal to pass a per-call hint — which would need a `[CONTRACT]` change to `POST /generate`.
4. **Anti-symmetry.** If everything comes back as *same observation, adjective flipped*, add a worked example of the two screens seizing genuinely different details. The instruction alone is weaker than one example.

## Do not remove

- The disagreement device requirement, or its "not disagreeing about whether something is good, but disagreeing about whether it is there" gloss. That distinction is the whole instruction; without it the model produces ordinary opposed opinions, which every beat already has, and the device silently stops existing. It is the hedge for the entire piece (§1).
- The sentence about the praise side needing the same filter as the roast side. It is counter-intuitive enough that it will be edited out by someone reasonable.
- The allusion examples.

## Known risks

**The unremarkable visitor.** Plain jeans, plain shirt, nothing to work with. There is no wardrobe hook, so the pressure is toward the body — which is where allusion starts. Covered by `perform-unremarkable` in the eval set and it is the hardest case there. If it fails, the fix is probably an explicit instruction to write about the *absence* of decisions rather than the person.

**Descriptor drift across beats.** The `descriptor` field exists so all four beats refer to the same person the same way (§5), but nothing enforces it downstream — a beat saying "the tall one" would be caught by the deny-list, but "the one on the left" would not. Worth watching in eval output.

**Model change.** Everything above is calibrated against whatever model the eval set was last run on. A model swap invalidates the calibration, not just the phrasing — re-run the full set, and pay particular attention to the gate rather than the jokes.
