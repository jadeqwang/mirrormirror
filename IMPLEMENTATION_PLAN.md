# Mirror Mirror — Implementation Plan v1

**Source of truth:** `Mirror Mirror — Project Spec v0.3.md`. If this plan and the spec disagree, the spec wins. Read the spec's "Decisions already made" framing before proposing alternatives — most obvious ideas were already rejected for stated reasons.

**Audience:** a heterogeneous pool of agents (gpt-5.6-sol, Opus 5, Sonnet, Fable) working concurrently. This doc exists so you can pick up a workstream cold, without talking to the other agents. The mechanism that makes that safe is **frozen contracts** (§2) plus **file ownership** (§3). Do not edit files outside your workstream's ownership list; do not change a frozen contract without updating this doc and flagging it in your PR title with `[CONTRACT]`.

---

## Status — reviewed 2026-08-09

Lanes A–F were built by Codex. The components are good: the safety-critical parsing, the detection model, and the state machine all match the spec closely and have real tests. **What has not happened is integration.** `kiosk/src/main.ts` starts the video pipeline and nothing else; detection, the state machine, the generation client, and the presentation layer are imported only by their own tests. The production bundle transforms 6 modules and weighs 7.9 kB, which is the whole story in one number.

| Lane | Status | Summary |
| --- | --- | --- |
| A. Kiosk shell + video | ✅ Built, unverified on hardware | Cameras pinned by deviceId/label with no enumeration fallback, both feeds mirrored, praise grade complete and photographic-only, debug overlay live. MJPEG can't be forced from the browser — documented honestly, needs `v4l2-ctl` verification on the Pi. |
| B. Detection + state machine | ⚠️ Components done, not wired | Model is spec-exact (160×120, running-average background, ROI mask, hysteresis both edges, freeze). State machine implements every spec §6 rule. Two bugs below. Nothing calls either. |
| C. Generation + safety gate | ⚠️ Done and tested; provider unratified | `parseGateBeforeBeats` genuinely never touches beats on skip, and there's a test proving it. Frame stays in memory. But the provider is OpenAI-shaped and nobody decided that. |
| D. Presentation | ⚠️ Component done, not wired | Typewriter, strict alternation via a `beat_done` handshake, accumulate at 40%, abort fade, pre-roll first char painted synchronously. Doesn't load the pre-roll pool from disk. Nothing calls it. |
| E. Server + reliability | ✅ Built; two bring-up bugs | systemd units with `Restart=always` and real hardening, provisioning script, ops README that covers the spec's hardware gotchas properly. Static server doesn't serve the files the kiosk fetches. |
| F. Dev harness | ⚠️ Mostly done; can't run the loop | Mock camera + clips, mock generation cases, two-window dev script, conformance suites. No `/generate` proxy in dev, so M1 can't actually be demonstrated. |
| G. Writer prompt + content | ⚠️ Written, never executed | Prompt, deny-list, 40 fallback conversations, pre-roll pool, 32-case eval set. The prompt has never been run against a model and the eval set has no images. |
| H. Grade tuning + wall label | ❌ Not started | Lane A parameterised every knob, so this is unblocked. No tuning pass, no `content/grade-tuning.md`, no wall label draft. |
| I. Integration + bring-up | ❌ Not started | The gap. See §5. |

**Milestone reality:** M1 (full loop on a laptop) is **not met** — no path currently exists from a trigger to four rendered beats. M2 and M3 are untouched, which is expected.

---

## 0. Architecture summary (decided — do not relitigate)

One repo, two processes:

1. **`server/` — small Node.js process.** Holds the API key, makes the ONE structured vision+writer call, runs the deny-list backstop, serves the static frontend, exposes a tiny local HTTP API. Node because it's one runtime, easy systemd unit, no build step required beyond the frontend's.
2. **`kiosk/` — static web app**, loaded by two Chromium kiosk windows (one per display, `?screen=praise` / `?screen=roast`). Owns cameras, compositing, detection, the state machine, and text presentation. Both windows load the same app; the query param selects role. The **praise window is the conductor** (it owns the camera used for detection and the state machine); the roast window is a follower driven over a `BroadcastChannel`.

Why the split: the spec requires everything visual in Chromium (§3 of spec), and the API key must not live in a kiosk browser profile. The server is deliberately dumb — no state machine, no detection, no timing. If it restarts mid-performance the kiosk falls back to the offline pool and nobody notices.

**Stack:** vanilla TypeScript + Vite for `kiosk/`, plain Node 20+ (no framework, or bare `express`) for `server/`. No React — the UI is two video elements and text layers; a framework adds boot time on a Pi 5 and merge surface between agents.

---

## 1. Workstreams

Nine lanes. A–F are code; G–H are content/prompt work; I is integration. Lanes marked **[deep]** involve judgment/creative/safety-critical work — route to Opus 5 / Fable. Lanes marked **[spec'd]** are well-defined implementation against a contract — good for Sonnet / gpt-5.6-sol.

### A. Kiosk shell + video pipeline **[spec'd]** — ✅ built
Two-window boot, camera acquisition, MJPEG forcing, mirroring, praise-side grade.

> **Status:** delivered in `kiosk/src/{main,video}.ts`, `styles.css`, `docs/day-one-measurements.md`. Grade is a CSS filter chain plus a radial-masked blurred underlay, a screen-blended bloom copy, and a gradient vignette — photographic only, no geometry warping, as §9 requires. Camera selection matches an exact `deviceId` or a unique label substring and never falls back to enumeration order. Debug overlay reports fps, resolution, dropped frames, decode time and main-thread lag. Measurement *procedures* are written and thorough; no measurement has been taken.

- Chromium launch scripts: two kiosk windows, one per display, correct URL params. (Actual display placement lives in lane F's boot scripts; here, just make the app run given a window.)
- `getUserMedia` with explicit `deviceId`; a `config.json` maps role → camera by **device path/serial**, never enumeration order (spec §2 gotchas).
- Constraints: MJPEG, 720p, 20–24fps. Verify actual negotiated format and expose it in the debug overlay (lane A owns a `?debug=1` overlay showing fps, resolution, format, CPU-ish timing stats).
- Both feeds mirrored horizontally.
- Praise grade per spec §3: CSS `filter` chain (saturate/contrast/brightness/slight sepia), radial-gradient vignette overlay, duplicated-blurred-layer bloom, radial-masked blurred underlay for soft-focus falloff. Ship it parameterized (CSS custom properties driven from `config.json`) so lane H can tune without touching code. **Photographic only — no landmark/geometry warping, ever** (spec §9).
- Deliverable includes the **day-one measurement harness**: a documented procedure + debug-overlay support for the stopwatch latency test and the 30-minute full-load CPU/thermal test (spec §3). These are make-or-break; build the harness first.

### B. Detection + state machine **[spec'd]** — ⚠️ built, not wired
Runs in the praise (conductor) window only.

> **Status:** delivered in `kiosk/src/detect/*` and `kiosk/src/state.ts`, with good tests. The occupancy model is spec-exact and the state machine implements every rule in spec §6 — generation fires on ARMED entry rather than after settle, PERFORMING ignores arrivals, a cleared zone aborts, SPENT needs one uninterrupted empty interval, F9 re-arms. Worker + `OffscreenCanvas` with a main-thread fallback. **Nothing constructs either class outside its test.**

- Occupancy gate exactly per spec §6: 160×120 offscreen canvas at 3–4fps from the praise `<video>`, grayscale running-average background model, foreground fraction inside an ROI trapezoid, hysteresis on both edges, background model **frozen during PERFORMING**. Web Worker + `OffscreenCanvas` where supported.
- ROI is hand-drawn: build a `?roi=1` editor mode (click to place trapezoid corners, persisted to `localStorage` + exportable into `config.json`). This gets used in the gallery in week 3 — make it usable by a human under time pressure.
- State machine: `EMPTY → ARMED (1.5s settle) → PERFORMING (locked) → SPENT → EMPTY` with every rule in spec §6: fire generation at ARMED entry, ignore arrivals during PERFORMING, abort+fade if zone clears mid-sequence, SPENT requires 4–5s empty, hidden keyboard re-arm key for the attendant.
- Emits events on the contract in §2.3. Does **not** render anything and does **not** call the network directly — it asks lane C's client.
- No second `getUserMedia`, no face detection, no extra processes (spec §6 is explicit).

### C. Generation client + safety gating **[deep — safety-critical parsing order]** — ⚠️ built; provider unratified
The kiosk-side client and server-side endpoint for the ONE call.

> **Status:** delivered in `server/{generate,model,mock-model}.ts` and `kiosk/src/gen-client.ts`. The safety property holds and is tested: `parseGateBeforeBeats` scans top-level fields in schema order, rejects reordered output, and returns on the skip branch *before* `beats` is parsed. Skipped beats never leave the server; the deny-list runs before the response; the frame lives only in a local buffer and is never written or logged. The kiosk client verifies the envelope again and falls back locally.
>
> **Unresolved:** `server/model.ts` calls an OpenAI chat-completions endpoint (`image_url` content, `response_format: json_schema`, `choices[0].message.content`, `OPENAI_API_KEY`, default `gpt-4.1-mini`). The spec never named a provider and neither did this plan, so this was decided in implementation. It needs ratifying or changing — see §5.

- Server endpoint `POST /generate` (contract §2.2): accepts a JPEG frame + group-size-unknown flag, calls the vision+writer model with **structured output, field order enforced** (gate fields before beats — spec §4 Mitigation 1), returns the parsed envelope.
- **Parsing order is a safety property:** server parses `skip` first; if true, `beats` is discarded server-side and never sent to the kiosk. The kiosk never sees skipped text.
- Server runs the **deny-list regex backstop** (lane G authors the list; C wires it) over beat text before responding. A deny-list hit converts the response to `skip: true, skip_reason: "denylist"`.
- Kiosk client: fire at ARMED, timeout at 6s, on timeout/error/skip pull a conversation from the **offline pool** (lane G authors; C implements loader + no-repeat shuffle).
- Also implement frame capture: praise `<video>` → canvas → JPEG blob, in-memory only, no disk writes, no logging of image data (spec §9 retention promise must stay literally true — do not add "helpful" debug frame dumps).

### D. Presentation layer **[spec'd, but timing feel matters — Sonnet fine, get I to review on hardware]** — ⚠️ built, not wired
Everything the visitor reads.

> **Status:** delivered in `kiosk/src/present/*`. Character-by-character typewriter with the first character painted synchronously so ARMED never shows a dead pause; strict alternation enforced by awaiting `beat_done` across windows rather than by timing; prior lines drop to `opacity: .4`; abort fades the whole layer. The pre-roll types on ARMED, praise-side only, and beat 1 waits for it to finish. **Not constructed anywhere outside its test, and it takes the pre-roll pool as an injected array — nothing loads `content/preroll-pool.json`.**

- Typewriter reveal, character by character; strict alternation (one screen types while the other holds); accumulate-don't-replace with prior beats dimmed to ~40%; white on black over video (spec §7).
- Pre-roll beat: on ARMED, praise screen instantly types a canned two-word acknowledgment from a small local pool; generated beats then start as beat 2 (spec §7). This must be instant — no network, no awaits.
- Beat routing: consume the envelope (§2.1), render `screen: praise` beats locally, forward `screen: roast` beats over the BroadcastChannel per §2.3.
- Abort path: mid-sequence fade-out (zone cleared) that doesn't look like a crash.
- Total reveal budget ~18–25s for four beats; expose per-character delay + inter-beat gaps in `config.json` for tuning.

### E. Server + reliability **[spec'd]** — ✅ built; two bring-up bugs
> **Status:** delivered in `server/{index,config,static,video-watchdog}.ts` and `ops/*`. Both systemd units restart always; the server unit runs `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`. `provision-pi.sh` installs packages, builds, installs units, and creates a 0600 env file. `ops/README.md` covers the spec's hardware gotchas — independent HDMI enumeration, by-id/by-path camera pinning, MJPEG confirmation, Ethernet, throttling checks, and an honest warning that X11 window coordinates don't carry to Wayland. `COLD_SPARE.md` exists.

- The Node server itself: static file serving, `/generate`, `/health`, config loading, env-var API key.
- systemd units with auto-restart for server and kiosk; Chromium crash → relaunch. Restart behavior lands **before** anything is built on top (spec §8).
- Pi provisioning script/notes: boot-to-kiosk (no desktop chrome, no cursor, no update nags), Ethernet config, verifying both HDMI outs enumerate as independent displays, pinning webcams by path.
- SD image checklist for the cold spare.
- A blank screen is the only visitor-perceivable failure (spec §8) — add a kiosk-side watchdog: if the video element stalls >5s, hard-reload the window.

### F. Dev harness / fake hardware **[spec'd — do this FIRST, it unblocks everyone]** — ⚠️ mostly built
> **Status:** delivered in `dev-harness/*`, `kiosk/src/dev/mock-camera.ts`, `fixtures/*`, `test/conformance/*`. Mock camera swaps in looping WebM clips (empty room / one person / three people) via `captureStream()`; the clips are generated deterministically by a checked-in script and contain synthetic silhouettes, not people. Mock generation covers normal/skip/malformed/slow, and the skip fixture carries sentinel text so a leak would be visible. Conformance suites encode the parser and state-transition requirements without owning either lane's API.

Most agents won't have a Pi, two C920s, or two displays. Build the substitute layer:

- `MOCK_CAMERA=1` mode: kiosk uses looping video files (check into `fixtures/`, a few clips of one person / three people / empty room) via `captureStream()` in place of `getUserMedia`.
- `MOCK_GENERATION=1` mode: server returns canned envelopes (normal, skip, malformed, slow) from `fixtures/envelopes/`.
- Two-browser-window dev mode on a laptop (`npm run dev` opens both roles).
- Unit-test scaffolding: state machine transitions and envelope parsing are the two things that must have real tests (they encode the safety and behavior rules). Detection thresholds and CSS grades are tuned by eye, not tested.

### G. Writer prompt + safety content + offline pool **[deep — this is the piece. Fable/Opus only]** — ⚠️ written, never executed
> **Status:** delivered in `content/*` and `fixtures/eval/*`, with `test/content.test.mjs` enforcing the beat rules, deny-list coverage, and the prompt's load-bearing instructions on every edit. Two spec contradictions were found and resolved — see `content/README.md`. **The prompt has never been run against a model and the eval set has no images**, so the gate is unproven and the tone is unjudged. That is the largest single piece of remaining risk in the project (§10 calls this the genuinely hard part).

The spec is explicit (§10): this and filter tuning decide whether the piece reads as slick or as a hackathon project.

- **The writer prompt.** Must produce: gate-fields-first structured output; the four-beat setup→counter→escalation→button structure with beats 3–4 referencing 1–2; 8–15 words per beat; ~70% roast-last, praise-last kept in the mix; the **disagreement device at least once per performance (hard requirement)**; shared-subject rule; anti-mechanical-symmetry instructions; tone rules (effort/coherence not objects, no body commentary, garment+color descriptors only, cap 3 named individuals, group-as-mass past 3); the full skip-condition superset (religious/cultural dress, mobility aids, medical devices, uniforms/scrubs, anything reading as protected category — praise side filtered same as roast side).
- **Test it against real photos of varied outfits** — including cases that must skip and cases that must not allude. The failure mode to hunt is the coy allusion ("you seem very grounded") described in spec §4. Build a small eval set (photos + expected skip/no-skip + notes) into `fixtures/eval/`; lane C's mock mode can replay it.
- **Deny-list regex** (Mitigation 2): ~10 lines, obvious-miss backstop, with comments explaining each entry.
- **Offline pool:** ~40 pre-generated four-beat conversations, situational/self-referential only, zero wardrobe references (spec §8). Also the pre-roll acknowledgment pool (~10 two-word lines).
- Deliverables are data files (`content/writer-prompt.md`, `content/denylist.json`, `content/offline-pool.json`, `content/preroll-pool.json`) — no code, so this lane never merge-conflicts with A–F.

### H. Visual grade tuning + wall label **[deep-ish — needs taste; Opus/Fable or a human]** — ❌ not started
> **Status:** unblocked and untouched. Lane A exposed every knob as a CSS custom property driven from config, and shipped sane defaults, but nobody has looked at the result and decided whether it is subtle enough not to be clocked and strong enough to notice. No `content/grade-tuning.md`, no wall label draft.

- Tune the praise-side grade parameters (via lane A's CSS custom properties): subtle enough not to be clocked immediately, strong enough to notice on a glance between screens (spec §7). Do a first pass on mock video; final tuning is on-site by a human — document the knobs and sane ranges in `content/grade-tuning.md`.
- Draft wall label text per spec §9: states the piece comments on appearance; notes incidental background capture; states no images/data recorded or retained (verify against the actual API provider's retention terms before finalizing — flag this as a human task).

### I. Integration + hardware bring-up **[one agent, or the human + one agent, serially]** — ❌ not started
> **Status:** the gap. Every other lane built to its contract and stopped at its own boundary, exactly as instructed — which means the seams were never closed by anyone. This is now the critical path and everything in §5 is downstream of it.

Not parallel — this lane owns `main`, merges the others, and runs on real hardware in weeks 2–3. Owns the day-one measurements (using lane A's harness), burn-in, thermal watching, and the spec §10 week-2 failure hunt. Also owns resolving any `[CONTRACT]` change requests.

---

## 2. Frozen contracts

These are the seams between lanes. They're deliberately boring. Changing one requires a `[CONTRACT]` PR that updates this section.

### 2.1 Generation envelope (server → kiosk, and model → server)

Exactly the spec §4 schema. Model-side structured output enforces field order (`people`, `group_size`, `skip`, `skip_reason`, then `beats`). Server→kiosk adds one wrapper:

```json
{
  "source": "generated | offline | error",
  "people": [{ "descriptor": "the one in the denim jacket", "palette": "blue / white", "formality": "casual", "coherence": "high" }],
  "group_size": 3,
  "beats": [
    { "screen": "praise", "text": "..." },
    { "screen": "roast", "text": "..." }
  ]
}
```

- If the model returned `skip: true`, the server substitutes `source: "offline"` and an offline-pool conversation. `skip_reason` is logged server-side (text only, never the frame) and **not** forwarded.
- `beats` is always exactly 4 entries by the time the kiosk sees it. Kiosk trusts but verifies: any malformed envelope → local offline pool.

### 2.2 Server HTTP API

- `POST /generate` — multipart: `frame` (JPEG), optional `hint_group_size`. Responds with the §2.1 envelope in ≤6s or the kiosk gives up. Server never persists the frame.
- `GET /health` — `{ ok: true, model: "...", uptime_s: n }`.
- `GET /` and static assets — the kiosk app.

### 2.3 Kiosk-internal events (`BroadcastChannel "mirrormirror"`)

Conductor (praise) → follower (roast):

```
{ type: "state", state: "EMPTY|ARMED|PERFORMING|SPENT" }
{ type: "beat", index: 0-3, screen: "praise|roast", text: "..." }   // follower renders only screen:"roast"
{ type: "beat_done", index: n }        // sent by whichever window finished typing → conductor sequences the next
{ type: "abort" }                      // fade out now
{ type: "reset" }                      // clear all text layers
```

Conductor owns all timing; the follower is stateless apart from its text layers. If the follower reloads mid-performance it comes back blank and rejoins at the next `reset` — acceptable.

### 2.4 `config.json` (checked in as `config.example.json`; real one is per-device)

```json
{
  "cameras": { "praise": "<by-path or serial>", "roast": "<by-path or serial>" },
  "video": { "width": 1280, "height": 720, "fps": 24 },
  "grade": { "saturate": 1.15, "contrast": 1.05, "brightness": 1.05, "sepia": 0.12, "vignette": 0.35, "bloom": 0.25, "softfocus": 0.3 },
  "detection": { "roi": [[x, y], [x, y], [x, y], [x, y]], "sample_fps": 4, "enter_frames": 4, "exit_frames": 8, "threshold": 0.08 },
  "timing": { "settle_ms": 1500, "spent_empty_ms": 4500, "char_ms": 35, "beat_gap_ms": 900, "generation_timeout_ms": 6000 },
  "rearm_key": "F9"
}
```

Field names above are frozen; numeric values are tuning defaults, change freely.

### 2.5 Repo layout

```
server/           # lane E owns; lane C owns generate.ts + denylist wiring
kiosk/src/
  main.ts         # lane A (boot, role selection)
  video.ts        # lane A (cameras, grade)
  detect/         # lane B (worker, ROI editor, background model)
  state.ts        # lane B
  gen-client.ts   # lane C
  present/        # lane D (typewriter, layers, preroll)
  bus.ts          # contract §2.3 — change only via [CONTRACT]
fixtures/         # lane F; eval photos lane G
content/          # lane G/H — prompts, pools, denylist, tuning notes
ops/              # lane E — systemd units, provisioning, chromium launch
docs/             # this file, spec, measurement procedures
```

---

## 3. Concurrency rules for agents

1. **One lane per agent.** Claim a lane by opening a draft PR titled `[A] kiosk shell` etc. Check open PRs before claiming.
2. **Own your files.** The §2.5 map is the ownership map. Shared files (`bus.ts`, `config.example.json`, this doc) change only via `[CONTRACT]` PRs, which lane I merges first and everyone rebases on.
3. **Stubs over waiting.** If you need another lane's piece, code against the contract and drop a stub in your own directory (e.g., lane D fakes `bus.ts` events from a keyboard handler). Lane F's mocks exist to make this cheap — if F isn't merged yet, write the minimal mock you need inside your lane and delete it at integration.
4. **Don't "improve" the spec.** In particular (all explicitly rejected in the spec): no second camera stream, no OpenCV on the display path, no GStreamer (unless lane I's latency measurement fails), no face detection, no audio, no geometry-warping beauty filter, no removing any of the three safety mitigations, no making the gate check prompt-level-only.
5. **Safety invariants are load-bearing** and cross lanes C+G: gate parsed before beats, skipped beats never leave the server, deny-list runs before render, frames never persisted. If your change touches any of these, say so in the PR description even if it seems incidental.
6. **Small PRs against `main`, rebase daily.** Lane I merges; content lanes (G/H) can merge any time since they touch only `content/`.

---

## 4. Sequencing and milestones

Lanes are parallel but not dependency-free:

```
F (mocks)  ──┬─→ A, B, C, D can all run fully concurrently against contracts + mocks
G (prompt) ──┴─→ C's eval replay; otherwise independent
E runs independently (ops), integrates last
H waits on A's grade knobs (days, not weeks)
```

- **M1 (end week 1, per spec §10):** on a laptop with mock cameras — full loop: fake trigger → generation (real API) → gate inspection → four beats typed across two browser windows, pre-roll covering latency. Plus lane G's prompt passing its eval set, and the day-one measurement *procedures* written even though hardware measurements wait for the Pi.
- **M2 (week 2):** everything on the Pi. Real cameras, real latency + 30-min load measurements, systemd restart proven by `kill -9`, burn-in running. Failure hunt per spec §10.
- **M3 (week 3):** on-site. ROI drawn in situ, grade tuned in the room on real people, offline-pool behavior verified by pulling Ethernet, cold spare flashed and in the box.

**If schedule slips**, the spec pre-decides the cut: drop person counting nuance — keep presence detection, set `group_size` conservatively, address groups as a mass. Nothing else gets cut before that.

---

## 5. What's left (from the 2026-08-09 review)

Roughly in the order it should be done. §5.1 blocks everything else.

### 5.1 Integration — the critical path (lane I)

Every lane built to its contract and stopped at its boundary, so no one closed the seams. Concretely:

- **`kiosk/src/main.ts` boots video and stops.** It needs the conductor/follower split, detection feeding the state machine, the state machine calling the generation client, and the presentation layer rendering the result. Right now it creates an empty `#text-layers` element that nothing ever writes to.
- **`kiosk/src/bus.ts` (§2.3) was never created.** The contract exists twice and partially: the `ConductorEvent` union lives in `state.ts`, and a bare `createMirrorMirrorChannel()` lives in `present/index.ts`. Neither is the shared typed module the plan froze, and the two windows have never spoken to each other.
- **`config.example.json` (§2.4) was never created.** `main.ts` fetches `/config.json`, then `/config.example.json`, then falls back to defaults with empty camera selectors — which throws *"Camera selector is empty"* at boot. Nothing on the Pi is configurable today. `ops/README.md` already tells the installer to put by-id paths in "the deployed `config.json`" that no file describes.
- **`main.ts` drops most of the config contract.** It parses `cameras`, `video`, and `grade`; `detection`, `timing`, and `rearm_key` are ignored.
- **The server doesn't serve the files the kiosk fetches.** `serveStatic` roots at `kiosk/dist`, so `/content/offline-pool.json` (the gen-client's default URL) and `/config.json` both 404. The offline pool is specifically the thing that must never fail.
- **Nothing loads `content/preroll-pool.json`.** `Presentation` takes the pool as an injected array.
- **`installVideoStallWatchdog` is unwired** and lives in `server/` despite being browser code. Move to `kiosk/src/` and call it.
- **Wire `Presentation`'s completion back to `stateMachine.complete()`**, or the machine never reaches SPENT.

### 5.2 Bugs found in review

1. **ROI editor coordinate space — highest consequence.** `roi-editor.ts:62` records clicks in screen space, but the detector samples the *unmirrored* source video. CSS mirrors the display with `scaleX(-1)`, so x is flipped between the two; `object-fit: cover` crops differently again when window and video aspect ratios differ. **The ROI drawn on site will gate on the wrong region.** Fix before week 3 — this gets drawn in the gallery under time pressure, and it will look like a detection tuning problem rather than a coordinate bug.
2. **`launch-chromium.sh` uses `wait -n` under `#!/bin/sh`.** Raspberry Pi OS `/bin/sh` is dash, which has no `wait -n`; with `set -eu` the script exits, `cleanup` kills both browsers, systemd restarts, and it loops. Change the shebang to `#!/bin/bash`.
3. **Camera label lookup runs before permission is granted.** `resolveCameraDeviceId` calls `enumerateDevices()` before any `getUserMedia`, so on a fresh kiosk profile labels are empty and a by-label selector fails with the permission hint. Needs a throwaway `getUserMedia` first, or a bring-up step that records the opaque `deviceId`s after granting once.
4. **A rejected generation strands the machine in ARMED.** `state.ts:89` swallows the rejection deliberately, but the visitor then sees the pre-roll and nothing else until they walk away — which contradicts §8's "a blank screen is the only failure state a visitor can perceive". Latent today because lane C's client resolves with a fallback rather than rejecting, but the conductor shouldn't depend on that.
5. **`commandExists()` always returns true** (`open-two-windows.mjs`), so `npm run dev` spawns `google-chrome` whether or not it exists and the "open these URLs manually" fallback never prints.
6. **`publicDir: "../fixtures"`** copies the whole fixture tree into the kiosk build, including `fixtures/eval/`. Harmless today, but if eval photographs are ever added they would be published into the built kiosk, against the retention promise on the wall label.

### 5.3 Decisions only a human can make

- **Which model provider.** `server/model.ts` calls OpenAI chat-completions with a `gpt-4.1-mini` default; the spec never named a provider, so this was chosen in implementation. Ratify it or switch. Switching to Claude means the Messages API shape in `model.ts` (image content block with a base64 source, `output_config.format`, an explicit `max_tokens`) and `ANTHROPIC_API_KEY` in `config.ts`. **Either way, the assumption that the provider emits JSON properties in schema order is the most safety-critical untested thing in the build** — `parseGateBeforeBeats` throws if the order drifts, which fails safe into the offline pool, but if it drifts *always* then no generated performance ever renders. Verify against the live provider early.
- **Where the writer prompt goes.** It is currently sent as a user-turn text block next to the image; `content/README.md` documents it as a system prompt. Pick one and make the two agree.
- **Monitor model and orientation** (spec §11) still blocks final layout numbers.

### 5.4 Project hygiene

- **Nothing typechecks the TypeScript.** There is no `tsconfig.json` and no `@types/node`; Vite strips types and `node --test` strips types. Type errors across module boundaries — exactly the errors integration will produce — are currently invisible. Add a tsconfig, `@types/node`, and an `npm run typecheck`.
- **No npm script for the server build.** `provision-pi.sh` calls `npx vite build --config server/vite.config.ts` directly.
- **No `/generate` proxy in dev.** `npm run dev` starts Vite alone, so even after wiring, the full loop can't be demonstrated on a laptop. Either proxy `/generate` to the node server or start both from the dev script.

### 5.5 Still outstanding from the original plan

- **Lane G:** source eval photographs, run the prompt against a live model, score the gate. Untested prompt is the biggest quality risk in the project.
- **Lane H:** grade tuning pass, `content/grade-tuning.md`, wall label draft (needs the provider's retention terms, so it depends on §5.3).
- **Lane I:** day-one latency and CPU measurements, 30-minute thermal run, burn-in, on-site ROI and grade tuning, cold spare flashed.

---

## 6. Who does what next (assigned 2026-08-09)

**The principle.** Codex takes bounded fixes with mechanical acceptance criteria, in files it already authored. Claude takes the seams, the cross-window contracts, and anything that needs judgment about the piece.

That split follows directly from what the review found. Codex's code quality was not the problem — the gate parser, the occupancy model, and the state machine are all good. The problem was that nine agents each built to a contract and stopped at its edge, so nobody owned the joins. **Integration must not be re-partitioned into lanes.** One owner holds the whole picture or the same gap reappears one level up.

### 6.1 Codex — bounded fixes, parallel-safe

Independent of each other and of §6.2, with one exception: **do the typecheck task first**, because integration is about to exercise every module seam and type errors there are currently invisible.

| # | Task | Done when |
| --- | --- | --- |
| 1 | Add `tsconfig.json`, `@types/node`, and `npm run typecheck`. **Land this first.** | `npm run typecheck` passes clean on the current tree, and covers `kiosk/src`, `server`, and the `.test.ts` files. |
| 2 | Write `kiosk/src/config.ts`: a typed loader/parser for the **full** §2.4 contract, with per-field fallbacks. Add `config.example.json` at the repo root. Do **not** edit `main.ts` — §6.2 imports this. Exact export contract below. | Every §2.4 field round-trips with a sane default; an absent or partial config never throws; `config.example.json` matches the field names in §2.4 exactly. |
| 3 | Serve `/content/*` and `/config.json` from the node server, and add a `/generate` proxy to the dev setup. | `curl localhost:4173/content/offline-pool.json` returns the pool; `npm run dev` serves `/generate` from the mock without a second manual process. Path traversal stays blocked. |
| 4 | `ops/launch-chromium.sh`: `wait -n` needs bash. | Shebang is `#!/bin/bash`; the script survives killing one browser without exiting non-zero under dash-free assumptions. |
| 5 | `video.ts`: unlock device labels before matching — a throwaway `getUserMedia` (or equivalent) before `enumerateDevices`, then release it. | A by-label selector resolves on a fresh Chromium profile with no prior grant. |
| 6 | `dev-harness/open-two-windows.mjs`: `commandExists()` currently returns a hardcoded `true`. | A machine without Chromium prints the manual-URL fallback instead of spawning a doomed process. |
| 7 | Narrow `kiosk/vite.config.ts` `publicDir` so `fixtures/eval/` cannot reach the build; keep the mock clips served. | `npm run build` produces no `dist/eval/**`; mock camera clips still load in dev and prod. |
| 8 | Add `npm run build:server` wrapping the command `provision-pi.sh` currently inlines. | `npm run build && npm run build:server` reproduces what provisioning does. |

**Export contract for task 2** — frozen, because `main.ts` is written against it in parallel. Reuse the existing types rather than redeclaring them: `ScreenRole`, `VideoConfig`, `GradeConfig` from `./video`, and `Roi` from `./detect/model`.

```ts
export interface KioskConfig {
  cameras: Record<ScreenRole, string>;
  video: VideoConfig;
  grade: GradeConfig;
  detection: { roi: Roi; sample_fps: number; enter_frames: number; exit_frames: number; threshold: number };
  timing: { settle_ms: number; spent_empty_ms: number; char_ms: number; beat_gap_ms: number; generation_timeout_ms: number };
  rearm_key: string;
}

/** Tries /config.json, then /config.example.json, then built-in defaults. Never throws. */
export async function loadKioskConfig(fetchImpl?: typeof globalThis.fetch): Promise<KioskConfig>;
export const DEFAULT_KIOSK_CONFIG: KioskConfig;
```

`KioskConfig` must stay structurally assignable to `VideoPipelineConfig` so it can be passed straight to `startVideoPipeline`.

### 6.2 Claude — seams, contracts, and judgment

Ordered. Items 1–2 are the critical path; 6.1#1 and 6.1#2 should land first.

1. **`kiosk/src/bus.ts`** — write the §2.3 contract as one typed module and make it the only definition. Today `ConductorEvent` lives in `state.ts` and a bare channel factory lives in `present/index.ts`; both get migrated. This is a frozen contract, so whoever writes it fixes the shape everything binds to — it goes first.
2. **Integration in `main.ts`** — conductor/follower split by role, detection feeding the state machine, the state machine calling the generation client, the presentation layer rendering the envelope, the pre-roll pool loaded from `content/`, `installVideoStallWatchdog` actually installed, and `Presentation` completion driving `stateMachine.complete()`. The one task that must not be subdivided.
3. **ROI editor coordinate mapping** (§5.2 #1) — map click position through the mirror transform and `object-fit: cover` into source-pixel space. Subtle, and expensive to get wrong on site.
4. **Generation-failure fallback** (§5.2 #4) — a rejected call must not strand the machine in ARMED. Decide whether the fallback belongs in the client or the conductor; it touches spec §8's "a blank screen is the only failure a visitor can perceive".
5. **Provider implementation + live ordering check** — once §6.3 decides. The check matters more than the implementation: confirm against the real endpoint that JSON properties actually arrive in schema order, because `parseGateBeforeBeats` throws if they don't, and a permanent drift means no generated performance ever renders.
6. **Prompt placement** — reconcile the user-turn text block in `model.ts` with `content/README.md`'s claim that it is a system prompt.
7. **Lane G eval run and scoring**, once photographs exist.
8. **Lane H grade tuning pass and wall label draft** — the label is blocked on the provider's retention terms, so it trails §6.3.

### 6.3 Blocked on a human

- **Which model provider**, and therefore the retention terms the wall label has to be literally true about.
- **Monitor model and mount orientation** — still open from spec §11; blocks final layout numbers.
- **Eval photographs** — consented or licensed, per `fixtures/eval/README.md`. Nothing in §6.2 #7 can start without them.
- **Everything on the Pi**: day-one latency and CPU measurements, the 30-minute thermal run, burn-in, and on-site ROI and grade tuning. Claude can interpret the results; it cannot take them.

---

## 7. Open questions (kiosk-relevant subset of spec §11)

- Monitor model/orientation — blocks final CSS layout numbers only; lane A should make layout resolution-agnostic.
- Whether praise-camera framing covers the standing zone — if it doesn't, the ROI editor (lane B) is the tool for finding that out fast on-site; no code contingency needed now.
- Beat count stays fixed at 4 (spec leans no on variable count) — lane D may hardcode 4 layers per screen.
