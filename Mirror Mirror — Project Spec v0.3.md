# Mirror Mirror — Project Spec v0.3

**Status:** committed, gallery show confirmed. \~3 weeks to install.

**Purpose of this doc:** hand-off context for other Claude instances working on any part of this build. Read "Decisions already made" markers before proposing alternatives — most obvious suggestions were considered and rejected for stated reasons.

### Changelog v0.2 → v0.3

- **Extra detection camera removed.** Presence detection samples the praise-side webcam feed already decoded by Chromium; the generation call supplies the group count. See §6.  
- **Microphone and STT removed.** The piece is visual, the webcam microphones remain disabled, and no audio enters the pipeline.  
- Hardware is back to the two display webcams already in the project. No CSI camera, USB microphone, `v4l2loopback`, or second camera consumer is required.  
- Section numbering and reliability guidance updated to match the simpler build.

---

## 1\. Concept

Two screens, side by side, at human scale. A visitor stands in front of them. Each screen shows the visitor and delivers text about them. One praises. One roasts. They talk to each other. The humor is the piece.

**The turn:** the screens are not mirrors and are not showing the same image.

- The **roast** screen shows a plain, honestly flipped camera feed, shot from a low, off-axis angle nobody would choose for themselves.  
- The **praise** screen shows a subtly beautified feed — warm grade, soft focus falloff, highlight bloom, vignette — shot from slightly above eye level, straight on.

So the mirror that flatters you is also the one distoring what you look like, and the cruel one is the only one telling the truth. Wall text should not explain it.

### Risk introduced by the four-beat format — read this

The turn is **visual**. Four beats of banter is a lot of gravity pulling attention into the text. It may help (more dwell time, more glances between screens) or it may mean visitors leave delighted having never noticed the two feeds differ.

The hedge is the **disagreement device** (§4). At least one beat per performance must have the two screens contradicting each other about what they can see. That points at the discrepancy without explaining it. Treat this as a hard requirement of the writer prompt, not a flourish.

---

## 2\. Hardware

| Component | Choice | Notes |
| :---- | :---- | :---- |
| Compute | Raspberry Pi 5, 4GB | CanaKit Starter Kit PRO, ordered |
| Cooling | Active cooler (in kit) | required, this runs hot |
| Power | Official/kit 27W USB-C PD | undervoltage causes phantom "software" bugs |
| Boot media | 64GB SanDisk Extreme A2 microSD | **flash an identical spare same day** |
| Displays | 2× monitors, matched pair | sourced from owner's server room |
| Display cameras | 2× Logitech C920S (UVC) | one per screen, both USB **3.0** ports |
| Audio out | none | still a text-only piece |
| Trigger | presence detection from praise-side C920S | samples the existing browser video; no extra camera |

### Why detection uses the praise-side webcam

- Chromium already owns and decodes this stream for display. Detection downsamples frames from the existing `<video>` element to a tiny canvas; it does **not** open the C920 a second time or add another USB stream.  
- The praise camera is the centered, above-eye-level view and therefore the better of the two existing angles for seeing the standing zone. Frame it wide enough to include the full trigger area, then use a hand-drawn ROI to ignore the rest.  
- Presence detection is simple pixel/background analysis, not a continuous neural-network workload. The vision generation call already sees the captured frame and returns `group_size`, so a separate person-counting model is unnecessary.  
- This keeps detection, rendering, and the state machine in one kiosk application. If measurements show frame sampling causes visible stutter, reduce sampling frequency or canvas size before adding hardware.

### Audio is intentionally out of scope

The C920S microphones are disabled and no separate microphone is installed. The work is about two conflicting images; listening adds compute load, latency, consent complexity, and another conceptual channel without being necessary to the piece.

### Notes / gotchas

- Pi 5 micro-HDMI ports are physically fragile. Use proper micro-HDMI→HDMI cables, not adapters with heavy cables hanging off them. Strain-relieve both to the enclosure. A yanked port mid-show is the realistic failure mode.  
- Confirm early that both HDMI outs enumerate as **independent** displays, not mirrored.  
- Monitors are likely landscape computer monitors, not full-length. Framing is head-and-shoulders / portrait rather than full-body. Acceptable and arguably stronger — but confirm the pair is the same model. Mismatched panel color temperature wrecks a symmetric diptych.  
- Pin the two webcams by device path/serial everywhere, not enumeration order.

---

## 3\. Video pipeline

**Chosen approach: Chromium in kiosk mode, two windows, one per display.**

- `getUserMedia`, cameras selected explicitly by `deviceId` (do not rely on enumeration order — not stable across reboots; pin by device path/serial).  
- Force **MJPEG**, not raw YUYV. Two raw 1080p30 streams will not fly over USB and the Pi 5 has **no hardware JPEG decoder** — decode is CPU work.  
- Target **720p at 20–24fps**. Nobody will notice; it buys headroom for compositing and low-rate detection sampling. Do not raise resolution until the full pipeline has passed burn-in.  
- Both feeds mirrored horizontally. Un-flipped self-video reads as subtly wrong in a way people feel but cannot name.  
- Praise-side grade via CSS `filter` (GPU-composited): `saturate`, `contrast`, `brightness`, slight `sepia` for warmth. Vignette \= radial-gradient overlay. Bloom \= duplicated blurred layer. Soft-focus falloff needs a radial-masked blurred copy underneath, or a small WebGL shader for that layer only.

**Rejected:**

- **OpenCV / per-frame numpy on the display path** — will not hold frame rate on 4 ARM cores. Small, infrequent canvas samples for presence detection are a different and much cheaper workload.  
- **GStreamer \+ `glshader`** — lower latency and more correct, but costs days in pipeline syntax and makes text overlay painful. Fall back to this *only* if Chromium latency measures badly.

### Day-one measurements (both make-or-break)

**1\. Camera latency.** Point a camera at a phone stopwatch; photograph phone and screen together; read the delta.

- **under \~100ms** → reads as a mirror. Concept holds.  
- **well above** → reads as *a screen showing you*, i.e. a store security monitor. Different and much weaker piece.  
- If high: drop resolution, confirm MJPEG, disable buffering on the video element.

**2\. CPU headroom with everything running.** Two MJPEG decodes, praise-side compositing, text animation, and the low-rate detection sampler, simultaneously, for 30 minutes while watching for thermal throttle and dropped frames.

---

## 4\. Text generation pipeline — ONE call

trigger fires

  → grab frame (display camera, praise side)

  → \[ONE structured call: vision \+ writer\]

  → inspect gate fields BEFORE reading beats

  → local deny-list regex on beat text

  → route beats to two screens, sequenced

### The safety cost of collapsing to one call — read before "simplifying" further

v0.1 used two calls specifically so the writer **could not see the image**. It therefore could not riff on the wheelchair, the hijab, the insulin pump, the scrubs — it did not know they existed. That was an architectural guarantee.

One call downgrades this to a prompt-level request. Prompt-level requests fail here in the worst possible way: the model doesn't *name* the mobility aid, it **alludes** to it. "You seem very grounded." "You're taking it easy today." Nobody in the room misses what happened, and now the machine looks like it's being coy about someone's body rather than merely tactless.

**This is recoverable but only if the mitigations below are all present.** Anyone removing one of them is removing the only thing standing between the piece and a bad write-up.

### Mitigation 1 — ordered output, gate before beats

The model emits gate fields **before** it writes anything. Structured output, field order enforced:

{

  "people": \[

    {

      "descriptor": "the one in the denim jacket",

      "palette": "blue / white",

      "formality": "casual",

      "coherence": "high"

    }

  \],

  "group\_size": 3,

  "skip": false,

  "skip\_reason": null,

  "beats": \[

    {"screen": "praise", "text": "..."},

    {"screen": "roast",  "text": "..."},

    {"screen": "praise", "text": "..."},

    {"screen": "roast",  "text": "..."}

  \]

}

Application logic parses `skip` **first**. If true, the entire `beats` array is **discarded unread** and the offline pool (§8) fires instead. You've burned one call and \~2s, which happens rarely and hides entirely behind the pre-roll beat (§7).

The guarantee is now "generated text is never *rendered*" rather than "never *generated*". Weaker, but the failure mode is a canned fallback line rather than a leak.

### Mitigation 2 — local deny-list

A regex pass over beat text before render. Ten lines, microseconds, catches the obvious misses. Not a substitute for the gate; a backstop for it.

### Mitigation 3 — skip conditions (superset of v0.1)

Set `skip = true` for any of:

**Visual:** religious and cultural dress; mobility aids, compression garments, adaptive clothing, medical devices; work uniforms and scrubs; anything reading as a protected category.

Note the praise side needs the same filter as the roast side. Gushing about someone's outfit when they're in work uniform lands just as badly as roasting it.

### The four beats

Structure: **setup → counter → escalation → button.** Beats 3 and 4 must reference beats 1 and 2\. If they don't, you have four one-liners and the conversational framing is decorative.

- **Length:** 8–15 words per beat. Four beats at v0.1 length is a wall of text and a 40-second reveal. Total reveal budget \~18–25s.  
- **Last word:** roast-last is the reliable button — target \~70%. Praise-last, landing after the roast has said something true, is a better piece and a weaker joke. Keep it in the mix.  
- **Screens accumulate, they don't replace.** Beat 1 stays on the praise screen dimmed to \~40% while beat 3 types in bright beneath it. Otherwise the callback lands on text the visitor can no longer see and the joke evaporates.

### The disagreement device — required

Let the mirrors **disagree about what they see**:

> — "You look tired." — "She does not look tired."

This points directly at the two feeds being different without a word of explanation. It is the strongest tool the conversation format gives us and it was not available in the one-line-each version. **At least one beat per performance must do this work** (see §1 risk note).

### Tone rules

- Aim at **effort and coherence, not objects.** *"Every item you're wearing is black and I still can't tell if that was a decision"* is a joke about choices. *"Those shoes look cheap"* is a joke about someone's bank balance.  
- No body or body size commentary.  
- **Shared subject.** Both screens seize the same detail and disagree about it. The green jacket is fearless on one screen and a cry for help on the other. Beats that wander onto unrelated details stop the diptych being one person seen twice — which is the entire concept.  
- Prompt hard against mechanical symmetry. A single model writing both sides drifts into *same observation, adjective flipped*, every time. Ask for the pair to sometimes seize different details, and for the roast to occasionally concede something.

---

## 5\. Multiple people

- **Cap at 3 named individuals.** Past that, address the group as a mass — *"there are five of you and one of you is clearly in charge"* — which is funnier anyway.  
- **Refer by garment and color only.** "The one in the denim jacket." **Never** by height, age, build, or any gendered noun. The `descriptor` field in §4 exists so the writer uses stable, safe references consistently across all four beats.  

**Opportunity:** the two mirrors can take opposite sides on *different* people.

> — "I like the one in green." — "The one in green is why the rest of you are dressed like that."

That's a joke the two-line version couldn't make. Lean on it.

---

## 6\. Detection (from the existing praise webcam)

Presence detection runs inside the kiosk against low-resolution samples from the praise-side `<video>` element. The webcam remains opened exactly once by Chromium. Do not create a second `getUserMedia` stream, a Python camera process, or a `v4l2loopback` device.

### Occupancy gate, always on

- Draw the praise video into a 160×120 offscreen canvas at 3–4fps and compare grayscale pixels against a slowly learned background. A running-average model is sufficient; MOG2 is not required.  
- Foreground-pixel fraction inside a hand-drawn ROI trapezoid over the standing spot.  
- Keep this work off the animation path: use a Web Worker with `OffscreenCanvas` where supported, or schedule short samples between render frames.  
- **Hysteresis on both edges** — N consecutive frames to enter, M to leave — or it flickers.  
- **Freeze the background model during PERFORMING.** Our own screens change brightness dramatically as text reveals, and that light lands on the visitor and the back wall.

### Confirmation and count

- On occupancy trip, capture one praise-side frame and fire the existing vision + writer call.  
- The structured response's `group_size` supplies the count used by §5. No separate detector or inference runtime is needed.  
- Treat a clearly unusable frame or `group_size: 0` as `skip: true`; use the offline fallback or return to ARMED rather than adding another hardware confirmation layer.

### State machine

EMPTY → ARMED (occupied, 1.5s settle) → PERFORMING (locked) → SPENT → EMPTY

- **Fire the API call at ARMED**, not after settle — buy back the 1.5s.  
- **PERFORMING ignores arrivals.** Someone joining mid-sequence does not restart it.  
- **Zone clears mid-sequence** → abort, fade, return to idle. Never perform to an empty room.  
- **SPENT requires the zone empty for 4–5s** before re-arming. Otherwise someone loops it by shuffling backward and forward.  
- **Hidden keyboard re-arm for the attendant.** Cheap insurance against the detection edge case you find on opening night.

No face detection anywhere in this. Presence and count only.

---

## 7\. Presentation

- **Typewriter reveal, character by character.** Reads as *thinking* and lands the punchline on the last word. Do **not** marquee-scroll — hard to read, looks like airport signage.  
- **Strict alternation, never simultaneous.** One screen types while the other holds. Simultaneous reveal makes the eyes ping-pong and neither lands.  
- **Accumulate, don't replace** (see §4). Prior beat dims to \~40%, new beat types beneath.  
- White type on black over the video. Highest legibility.  
- Make the beauty filter **subtle enough not to be immediately clocked, strong enough to notice on a glance between screens.** That delay before the visitor realizes the nice mirror has been editing them is where the piece lands. Tune by eye, on real people, in the actual room.

### Pre-roll beat — required

The cold-start path is trigger → frame → one structured generation → render. Even a **3–5 second** pause with two silent screens can read as *broken*, not as *thinking*.

**On ARMED, the praise screen instantly types a canned two-word acknowledgment** — *"oh, hello"* — from a small local pool. Costs nothing, buys \~3 seconds, and strengthens the conversational premise rather than papering over a gap. The generated beats then start as beat 2\.

This also covers the discarded-generation case in §4: a skip is invisible because the pre-roll is already on screen while the fallback loads.

---

## 8\. Reliability (unattended, 10hr gallery days)

- **A systemd unit with auto-restart for the kiosk.** Detection and the state machine live in that application, so there are no camera/STT services to coordinate. Put restart behavior in place *before* building anything on top.  
- Kiosk mode: boots straight into the piece. No desktop, no cursor, no update nags.  
- **Offline fallback pool.** \~40 pre-generated **four-beat conversations**, not 40 pairs. They cannot reference wardrobe, since they're used precisely when visual generation is unavailable or suppressed. Situational and self-referential material only.  
- **Ethernet, not venue wifi.**  
- Cold-spare SD card, flashed identically, in the box on site.  
- Because the piece has no audio output, a blank screen is the only failure state a visitor can perceive. Everything above serves that one goal.

---

## 9\. Ethics / public-facing

- **Wall label states plainly that the piece will comment on your appearance.** It does not need an audio-listening disclosure because the webcam microphones are disabled and no audio is captured.  
- Live feed will incidentally capture other visitors in the background. Frame tight enough that it's mostly the one person; note in the label.  
- **No images or visitor data are recorded or retained.** A frame exists in memory only long enough to make the generation request. Say so on the label, subject to the actual API provider's retention terms, and keep it literally true.  
- No face recognition, no identification, no persistence between visitors.  
- **Beauty filter must be photographic, never anatomical.** Off-the-shelf beauty filters work by warping facial geometry and lightening skin, encoding a specific and Eurocentric standard. A museum piece that visibly lightens some visitors' skin and not others is the version that gets written up badly, and deservedly. It is also a worse artwork: the joke becomes "the machine thinks you should look white" rather than "flattery is a distortion." Grade and optics only. This flatters everyone identically while asserting nothing about any individual's features. (Also: landmark warping is expensive on a Pi and visibly snaps when tracking slips, which is fatal to the illusion. The right call is also the cheap one.)

---

## 10\. Schedule

**Week 1** — pipeline running on any machine. One call → gate inspection → four beats → two text panes. **Measure camera latency and full-load CPU headroom on day one.** Get the roast tone right against real photos of varied outfits; this is the genuinely hard part and what the gallery is judging.

**Week 2** — assemble on the Pi. Run continuously and watch it fail. Expect: display enumeration flakiness, thermal throttling, panel color mismatch, outputs slipping past the gate, detection false-positives from passing foot traffic.

**Week 3** — install in the space. Tune to *that* room's lighting. Draw the praise-camera detection ROI in situ and verify that the artistic framing still covers the standing zone. Burn in. Leave real buffer; galleries always have a surprise about power or sightlines.

**Highest-leverage use of remaining time: the writer prompt and the filter tuning.** Those decide whether it reads as slick or as a hackathon project, and they're what people shortchange because hardware feels more urgent. It isn't.

**First thing to simplify if the schedule slips:** person counting. Keep presence detection, set `group_size` conservatively from the vision response, and address uncertain groups as a mass. Do not add a third camera to rescue counting.

---

## 11\. Open questions

- Monitor model and mount orientation — pending inventory check.  
- Exact framing/crop difference between the two camera angles.  
- Whether the praise-camera framing covers enough of the standing zone for reliable entry/exit detection.  
- Physical frame / plinth construction — not yet specified; it only needs to house the Pi, two displays, and their two webcams.  
- Beat-count flexibility: is 4 always right, or should groups get 6? Leaning no — keep it fixed, variable length wrecks the reveal timing budget.
