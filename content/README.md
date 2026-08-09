# content/ — lane G

Data files only, no code, so this lane never merge-conflicts with the implementation lanes. Everything here is loaded at runtime; nothing here needs a build step.

| File | Loaded by | Shape |
| --- | --- | --- |
| `writer-prompt.md` | lane C, as the system prompt for the one vision+writer call | The **entire file, verbatim**. Rationale and change notes live in `writer-prompt-notes.md` so they never leak into the prompt. |
| `denylist.json` | `server/generate.ts` → `loadDenylist()` | `{ "patterns": [{ "pattern", "flags", "note" }] }`. `note` is ignored by the loader. Compiled with the `u` flag. |
| `offline-pool.json` | `server/generate.ts` → `loadOfflinePool()` and `kiosk/src/gen-client.ts` → `loadOfflinePool()` | `{ "conversations": [{ "id", "beats": [4] }] }`. Both loaders read `.beats` and ignore `id`. |
| `preroll-pool.json` | lane D (presentation) — **not yet written** | `{ "screen": "praise", "lines": ["oh, hello", …] }`. See below. |

## Note for lane D: the pre-roll shape

`preroll-pool.json` is the one file here whose consumer does not exist yet, so its shape is a proposal rather than a frozen contract. It follows the convention lane C already set — an object with a named array (`patterns`, `conversations`, `lines`) — so the loaders all look alike.

The pre-roll must be **synchronous**: read at boot, held in memory, typed the instant the state machine enters ARMED, with no `await` between the trigger and the first character. It is what makes a 3–5 second generation gap read as thinking rather than as broken (spec §7), and it also hides a gate skip completely — the greeting is already on screen while the fallback conversation loads. If it has to wait for anything, it isn't doing its job.

## Two places the spec contradicts itself, and what I did

**1. The disagreement example uses a gendered pronoun.** Spec §4 gives the device as *"You look tired." / "She does not look tired."* — but §5 says refer to people *"never by height, age, build, or any gendered noun."* I resolved it toward §5: the prompt requires **they/them** or the garment descriptor, and the deny-list treats gendered pronouns as a hard catch. The example in the prompt reads *"They do not look tired."* If anyone prefers the spec's exact wording, that decision needs making deliberately — it changes the deny-list too.

**2. "The generated beats then start as beat 2."** Spec §7 says the praise screen types the two-word greeting first, so the four generated beats begin in slot two. Read literally with strict alternation, that forces the first generated beat onto the roast screen — and four alternating beats starting on the roast always end on the praise, which contradicts §4's target of ~70% roast-last.

So the alternation cannot start from the pre-roll. What the prompt says instead: the four beats alternate among themselves, and the **opening screen decides the closing screen** — open on praise for a roast button (the common case, ~70%), open on roast for a praise button (~30%). The pre-roll sits in front of either. When the performance opens on praise, that screen speaks twice in a row, which reads as the praise mirror carrying on its own thought — and since beats accumulate rather than replace (§7), the greeting is still visible above it, so it looks deliberate. When it opens on roast, the roast is cutting in on the greeting, which is also good.

## Things deliberately *not* in the deny-list

`practical`, `calm`, `grounded`, `comfortable`, `sensible`, `brave`, `inspiring`. These are the vocabulary of the coy-allusion failure the spec describes in §4 — and they are also ordinary English that a good beat may want. Banning them would starve the piece to guard against something the structured gate is supposed to catch upstream. They live in `fixtures/eval/README.md` as review prompts for a human reading eval output.

Same reasoning for the words dropped from the body and money patterns (`short`, `build`, `frame`, `figure`, `dressing`, `price`, `cost`, `fake`, `habit`): each would fire constantly on innocent text. A deny-list that converts most performances into canned fallbacks has broken the piece just as thoroughly as one that misses.

## Changing any of this

Re-run the eval set (`fixtures/eval/README.md`) after **any** edit to `writer-prompt.md`, including edits that look cosmetic. The requirement most likely to vanish silently during unrelated prompt editing is the disagreement device, which is the hedge for the entire piece (§1). Check it explicitly, every time.

The three safety mitigations — ordered output with the gate before the beats, the local deny-list, and the skip conditions — are load-bearing together. Spec §4: anyone removing one of them is removing the only thing standing between the piece and a bad write-up.
