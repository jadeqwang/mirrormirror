# Mirror Mirror — Implementation Plan v1

**Source of truth:** `Mirror Mirror — Project Spec v0.3.md`. If this plan and the spec disagree, the spec wins. Read the spec's "Decisions already made" framing before proposing alternatives — most obvious ideas were already rejected for stated reasons.

**Audience:** a heterogeneous pool of agents (gpt-5.6-sol, Opus 5, Sonnet, Fable) working concurrently. This doc exists so you can pick up a workstream cold, without talking to the other agents. The mechanism that makes that safe is **frozen contracts** (§2) plus **file ownership** (§3). Do not edit files outside your workstream's ownership list; do not change a frozen contract without updating this doc and flagging it in your PR title with `[CONTRACT]`.

---

## Status — provider measured 2026-08-10

Lanes A–F were built by Codex and reviewed; the seams were then closed and the bounded fixes landed (§6). **The loop now closes in software.** A trigger runs detection → state machine → one generation call → four beats alternating across two windows → SPENT, and `kiosk/src/integration.test.ts` covers that path plus the failed-generation and visitor-leaves branches. The production bundle went from 6 modules to 19 with the detection worker code-split.

The provider is now wired and, as of 2026-08-10, **actually called** — which turned up one blocker that is not a matter of taste or tuning. Workers AI returns JSON object keys in **alphabetical order**, so `beats` always precedes `skip` and the gate can never come first under the current field names. It fails safe (canned conversation, nothing leaks) but it fails on *every* call, so the piece would run all day without once talking about the visitor. A one-word schema rename fixes it and is demonstrated working; it needs a decision because it touches a frozen contract. See §5.1.

| Lane | Status | Summary |
| --- | --- | --- |
| A. Kiosk shell + video | ✅ Built, unverified on hardware | Cameras pinned by deviceId/label with no enumeration fallback, both feeds mirrored, praise grade complete and photographic-only, debug overlay live. MJPEG can't be forced from the browser — needs `v4l2-ctl` verification on the Pi. |
| B. Detection + state machine | ✅ Built and wired | Model is spec-exact (160×120, running-average background, ROI mask, hysteresis both edges, freeze during PERFORMING). Detection now drives the machine. ROI coordinate mapping fixed and tested. |
| C. Generation + safety gate | 🚧 Wired and measured; **blocked on a schema decision** | Safety path proven end to end through real HTTP; frame stays in memory. Kimi answers in ~3.2s with thinking disabled. But Workers AI sorts keys alphabetically, so gate-before-beats cannot hold as named — §5.1 has the fix and the alternatives. |
| D. Presentation | ✅ Built and wired | Typewriter, strict alternation via a `beat_done` handshake, accumulate at 40%, abort fade, pre-roll painted synchronously on ARMED and loaded from `content/`. |
| E. Server + reliability | ✅ Built; bring-up bugs fixed | systemd units with `Restart=always` and real hardening, provisioning, ops README covering the spec's hardware gotchas. Now serves `/content` and `/config.json`; the dash shebang that would have restart-looped on the Pi is fixed. |
| F. Dev harness | ✅ Dev loop runs | Mock cameras and clips, mock generation cases, conformance suites. `npm run dev` now starts the API alongside Vite and proxies `/generate`, so the whole loop runs on a laptop. |
| G. Writer prompt + content | ⚠️ Written, **never executed** | Prompt, deny-list, 40 fallback conversations, pre-roll pool, 32-case eval set, all enforced by tests. The prompt has never been run against a model and the eval set has no images. |
| H. Grade tuning + wall label | ❌ Not started | Every knob is parameterised and defaults ship, so this is unblocked. No tuning pass, no `content/grade-tuning.md`, no wall label draft. |
| I. Integration + bring-up | ⚠️ Software done, hardware not started | Seams closed and verified. No day-one measurements, no thermal run, no burn-in, nothing on a Pi. |

**Milestone reality:** M1 is met *in code and in tests*, but **has never been run in a browser** — nobody has opened two windows and watched a performance, and no beat has ever come from a real model. Doing that needs no hardware and no decisions, and it is the single highest-value next step. M2 and M3 are untouched, as expected.

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

### B. Detection + state machine **[spec'd]** — ✅ built and wired
Runs in the praise (conductor) window only.

> **Status:** delivered in `kiosk/src/detect/*` and `kiosk/src/state.ts`, with good tests. The occupancy model is spec-exact and the state machine implements every rule in spec §6 — generation fires on ARMED entry rather than after settle, PERFORMING ignores arrivals, a cleared zone aborts, SPENT needs one uninterrupted empty interval, F9 re-arms. Worker + `OffscreenCanvas` with a main-thread fallback. Both are now constructed by `main.ts`, and the ROI editor's coordinate mapping has been corrected (§6.2).

- Occupancy gate exactly per spec §6: 160×120 offscreen canvas at 3–4fps from the praise `<video>`, grayscale running-average background model, foreground fraction inside an ROI trapezoid, hysteresis on both edges, background model **frozen during PERFORMING**. Web Worker + `OffscreenCanvas` where supported.
- ROI is hand-drawn: build a `?roi=1` editor mode (click to place trapezoid corners, persisted to `localStorage` + exportable into `config.json`). This gets used in the gallery in week 3 — make it usable by a human under time pressure.
- State machine: `EMPTY → ARMED (1.5s settle) → PERFORMING (locked) → SPENT → EMPTY` with every rule in spec §6: fire generation at ARMED entry, ignore arrivals during PERFORMING, abort+fade if zone clears mid-sequence, SPENT requires 4–5s empty, hidden keyboard re-arm key for the attendant.
- Emits events on the contract in §2.3. Does **not** render anything and does **not** call the network directly — it asks lane C's client.
- No second `getUserMedia`, no face detection, no extra processes (spec §6 is explicit).

### C. Generation client + safety gating **[deep — safety-critical parsing order]** — 🚧 measured; blocked on §5.1
The kiosk-side client and server-side endpoint for the ONE call.

> **Status:** delivered in `server/{generate,model,mock-model}.ts` and `kiosk/src/gen-client.ts`. The safety property holds and is tested: `parseGateBeforeBeats` scans top-level fields in schema order, rejects reordered output, and returns on the skip branch *before* `beats` is parsed. Skipped beats never leave the server; the deny-list runs before the response; the frame lives only in a local buffer and is never written or logged. The kiosk client verifies the envelope again and falls back locally.
>
> **Provider (decided 2026-08-09):** runtime is **Kimi K2.7 on Cloudflare Workers AI** (`@cf/moonshotai/kimi-k2.7-code`), reached through the OpenAI-compatible endpoint at `/client/v4/accounts/{id}/ai/v1/chat/completions`. `GENERATION_PROVIDER=openai` remains as a comparison path. The writer prompt now goes in a `system` message, matching what `content/README.md` always claimed.
>
> **Measured against the live endpoint on 2026-08-10.** Recorded here so nobody re-derives it:
>
> | Finding | Detail |
> | --- | --- |
> | Thinking mode is fatal by default | Kimi reasons unless told not to. With it on, output lands in `reasoning_content`, `content` is `""`, and the gate parser correctly rejects it — 13–26s per call, 0/5 usable. `chat_template_kwargs.thinking=false` is now sent by default; `CF_THINKING=on` restores it. |
> | Latency, thinking off | k2.7-code 2.4–3.7s (median 3.2s); k2.6 ~2.0s. Both inside the 5.5s server budget, neither measured **with an image yet**. |
> | Keys come back alphabetical | Top level returned `beats, group_size, people, skip, skip_reason`; nested person keys returned `coherence, descriptor, formality, palette`. Both exactly sorted, 5/5 runs. Deterministic, not drift — no prompt fixes it. |
> | The rename works | With `beats` renamed to `speech` and the schema written in the resulting sorted order, keys come back `group_size, people, skip, skip_reason, speech` — gate before lines, 3/3. |
> | Vision | **Never exercised.** Every call so far used the text-only `--no-image` probe. One photograph settles it. |
> | Skip path | Verified: a model-shaped skip yields a corpus conversation, `source: "offline"`, no model text in the response. |

- Server endpoint `POST /generate` (contract §2.2): accepts a JPEG frame + group-size-unknown flag, calls the vision+writer model with **structured output, field order enforced** (gate fields before beats — spec §4 Mitigation 1), returns the parsed envelope.
- **Parsing order is a safety property:** server parses `skip` first; if true, `beats` is discarded server-side and never sent to the kiosk. The kiosk never sees skipped text.
- Server runs the **deny-list regex backstop** (lane G authors the list; C wires it) over beat text before responding. A deny-list hit converts the response to `skip: true, skip_reason: "denylist"`.
- Kiosk client: fire at ARMED, timeout at 6s, on timeout/error/skip pull a conversation from the **offline pool** (lane G authors; C implements loader + no-repeat shuffle).
- Also implement frame capture: praise `<video>` → canvas → JPEG blob, in-memory only, no disk writes, no logging of image data (spec §9 retention promise must stay literally true — do not add "helpful" debug frame dumps).

### D. Presentation layer **[spec'd, but timing feel matters — Sonnet fine, get I to review on hardware]** — ✅ built and wired
Everything the visitor reads.

> **Status:** delivered in `kiosk/src/present/*`. Character-by-character typewriter with the first character painted synchronously so ARMED never shows a dead pause; strict alternation enforced by awaiting `beat_done` across windows rather than by timing; prior lines drop to `opacity: .4`; abort fades the whole layer. The pre-roll types on ARMED, praise-side only, and beat 1 waits for it to finish. `main.ts` now constructs it for both roles and loads `content/preroll-pool.json`, falling back to a built-in greeting if that file cannot be reached.

- Typewriter reveal, character by character; strict alternation (one screen types while the other holds); accumulate-don't-replace with prior beats dimmed to ~40%; white on black over video (spec §7).
- Pre-roll beat: on ARMED, praise screen instantly types a canned two-word acknowledgment from a small local pool; generated beats then start as beat 2 (spec §7). This must be instant — no network, no awaits.
- Beat routing: consume the envelope (§2.1), render `screen: praise` beats locally, forward `screen: roast` beats over the BroadcastChannel per §2.3.
- Abort path: mid-sequence fade-out (zone cleared) that doesn't look like a crash.
- Total reveal budget ~18–25s for four beats; expose per-character delay + inter-beat gaps in `config.json` for tuning.

### E. Server + reliability **[spec'd]** — ✅ built; bring-up bugs fixed
> **Status:** delivered in `server/{index,config,static,video-watchdog}.ts` and `ops/*`. Both systemd units restart always; the server unit runs `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`. `provision-pi.sh` installs packages, builds, installs units, and creates a 0600 env file. `ops/README.md` covers the spec's hardware gotchas — independent HDMI enumeration, by-id/by-path camera pinning, MJPEG confirmation, Ethernet, throttling checks, and an honest warning that X11 window coordinates don't carry to Wayland. `COLD_SPARE.md` exists.

- The Node server itself: static file serving, `/generate`, `/health`, config loading, env-var API key.
- systemd units with auto-restart for server and kiosk; Chromium crash → relaunch. Restart behavior lands **before** anything is built on top (spec §8).
- Pi provisioning script/notes: boot-to-kiosk (no desktop chrome, no cursor, no update nags), Ethernet config, verifying both HDMI outs enumerate as independent displays, pinning webcams by path.
- SD image checklist for the cold spare.
- A blank screen is the only visitor-perceivable failure (spec §8) — add a kiosk-side watchdog: if the video element stalls >5s, hard-reload the window.

### F. Dev harness / fake hardware **[spec'd — do this FIRST, it unblocks everyone]** — ✅ built
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

### I. Integration + hardware bring-up **[one agent, or the human + one agent, serially]** — ⚠️ software done, hardware not started
> **Status:** the seams are closed (§6.2) and the loop is covered by `kiosk/src/integration.test.ts`. What is left in this lane is entirely hardware and on-site: day-one latency and CPU measurements, the 30-minute thermal run, burn-in, ROI drawn in situ, grade tuned in the room, cold spare flashed. None of it can start without the Pi.

Not parallel — this lane owns `main`, merges the others, and runs on real hardware in weeks 2–3. Owns the day-one measurements (using lane A's harness), burn-in, thermal watching, and the spec §10 week-2 failure hunt. Also owns resolving any `[CONTRACT]` change requests.

---

## 2. Frozen contracts

These are the seams between lanes. They're deliberately boring. Changing one requires a `[CONTRACT]` PR that updates this section.

### 2.1 Generation envelope (server → kiosk, and model → server)

> ⚠️ **Pending `[CONTRACT]` change (§5.1).** The *model-facing* schema may rename `beats` to `speech` and reorder its properties so that the provider's alphabetical key ordering coincides with gate-before-lines. The **kiosk-facing envelope below is unaffected** either way — the server maps the field when it builds the response.

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

Conductor owns all timing; the follower is stateless apart from its text layers. If the follower reloads mid-performance it comes back blank and rejoins at the next `reset` — acceptable, which is why `isBusEvent` validates anything arriving on the channel.

**Implemented in `kiosk/src/bus.ts`, which is the only definition.** `state.ts` and `present/types.ts` import it and alias it to their original names (`ConductorEvent`, `PresentationEvent`). Do not redeclare this union anywhere else — it previously existed in two partial copies, which is how the two windows ended up never speaking.

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

**Implemented in `kiosk/src/config.ts`** (`KioskConfig`, `loadKioskConfig`, `DEFAULT_KIOSK_CONFIG`), with `config.example.json` checked in and served by the node server at both `/config.json` (falling back to the example) and `/config.example.json`. Every field validates individually and falls back on its own; a missing or malformed config never throws.

### 2.5 Repo layout

```
server/           # lane E owns; lane C owns generate.ts + denylist wiring
kiosk/src/
  main.ts         # boot, role selection, and the conductor/follower wiring
  config.ts       # contract §2.4 — change only via [CONTRACT]
  bus.ts          # contract §2.3 — change only via [CONTRACT]
  video.ts        # lane A (cameras, grade)
  detect/         # lane B (worker, ROI editor, background model)
  state.ts        # lane B
  gen-client.ts   # lane C
  present/        # lane D (typewriter, layers, preroll)
  watchdog.ts     # reload on a stalled video element
  integration.test.ts   # the whole loop, end to end
config.example.json     # contract §2.4, per-device copy is config.json (gitignored)
tsconfig{,.kiosk,.server}.json   # npm run typecheck
fixtures/         # lane F; eval photos lane G (untracked)
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

**How this actually played out (2026-08-09), because more concurrent work is coming.** There were no PRs and no branches — two agents worked simultaneously in one shared working tree, and it was clean. What made it work was not the PR mechanics but the two things underneath them:

- **The contract was frozen before either side started.** `main.ts` was written against `kiosk/src/config.ts` while that file did not yet exist, because its exact export shape was agreed and written into §6.1 first. Neither side had to wait, and the two halves met without an adaptation layer.
- **File ownership was stated explicitly and by name**, not implied by lane. Each agent was told which paths belonged to the other. Zero collisions across ~30 changed files.

The one hiccup was informative: the shared typecheck flagged an error in the *other* agent's file, which briefly looked like work to do. Say who owns a file the moment that happens rather than fixing across the fence.

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

## 5. What's left

The integration gaps, all six bugs, and the project-hygiene items the 2026-08-09 review found are **resolved** — §6 records what was done and how each was verified. What remains is below. None of it is blocked on more code.

### 5.1 Decisions only a human can make

**The gate ordering decision — blocking.** Workers AI sorts JSON keys alphabetically, so `beats` sorts before `skip` and the gate can never precede the lines. Nothing else in lane C can be trusted until this is settled. Three ways out, in the order I would take them:

1. **Rename `beats` → `speech` and write the schema in the resulting sorted order** (`group_size, people, skip, skip_reason, speech`). Demonstrated 3/3 on the live endpoint. Preserves *both* guarantees — the model still commits to `skip` before writing a line, and the application still discards unread — because alphabetical order and gate order now coincide. Also survives Cloudflare later honouring schema order, since the two orders would be identical. Contained to `server/generate.ts`, `content/writer-prompt.md` and the model-shaped fixtures: the kiosk-facing envelope in §2.1 keeps `beats`, so no kiosk change. Cost: a field name whose reason is non-obvious, hence written down here.
2. **Relax the parser** to find `skip` wherever it appears and still refuse to read `beats` when it is true. Smallest diff, no odd naming. But the lines are then *generated* before the gate decision, which is the property spec §4 Mitigation 1 exists to provide — and §4 says removing one of the three mitigations removes the only thing standing between the piece and a bad write-up.
3. **Two calls, as spec v0.1.** Strongest guarantee: a blind writer cannot allude to what it cannot see. Roughly doubles latency to ~6s, past what the pre-roll was sized to cover, and v0.3 collapsed to one call deliberately.

**Which Kimi.** `kimi-k2.7-code` is the code-tuned variant at ~3.2s; `kimi-k2.6` is the general vision model at ~2.0s. The piece wants comedy and social judgment, not agentic coding, and the faster one may also be the better writer here. A/B them on the eval set — one env var.

**Monitor model and mount orientation** (spec §11) — still blocks final layout numbers.

**Settled, recorded so it is not re-litigated:** the provider is Kimi on Workers AI (chosen partly for its voice, which is a legitimate reason for this piece). A skip falls back to the 40-conversation corpus, not a retry — retrying the same frame would re-roll until the safety gate stops firing, and it only stops firing when the gate makes a mistake. If the corpus ever needs more variety, the right version of "call again" is a **blind** second call with no image attached, which restores the v0.1 structural guarantee at roughly +2–3s.

### 5.2 Never done, and still the real risks

- **Run it in a browser.** M1 is proven in tests but nobody has opened two windows and watched a performance. `npm run dev` now does the whole loop against mocks. This needs no hardware and no decisions.
- **Run the writer prompt against a model, with an image.** Text-only probes now work, but no call has ever carried a photograph, so vision is unverified and the with-image latency is unknown. Beyond that the gate is unscored and the tone unjudged — that needs the eval photographs (`fixtures/eval/README.md` covers sourcing and consent) and is blocked behind the §5.1 decision, since a rename changes the prompt the eval judges.
- **Grade tuning and the wall label** (lane H). Unblocked — every knob is parameterised. The label depends on the provider's retention terms.
- **Everything on the Pi** (lane I): day-one latency and CPU measurements, the 30-minute thermal run, burn-in, ROI drawn in situ, grade tuned in the room, cold spare flashed.

### 5.3 Follow-ups found while integrating — small, none blocking

- **No timeout on `beat_done`.** If the roast window is closed or crashed, the conductor waits forever partway through a performance. It recovers when the visitor leaves, but a follower-liveness timeout that finishes on the praise screen alone would match §8 better.
- **A saved ROI needs a page reload.** `VideoOccupancyDetector` exposes no `setRoi` passthrough. Fine if the on-site procedure says "save, then reload"; worth wiring before week 3.
- **`/content/*` serves the whole directory**, so `writer-prompt.md` is fetchable. Loopback-only, so local-only — but an allowlist of the three JSON files the kiosk needs would be tighter.
- **Skips are logged but never counted.** `console.info("generation skipped", {reason})` reaches journald, so `journalctl -u mirrormirror-server | grep -c "generation skipped"` works, but there is no rate or breakdown by reason. During week-2 burn-in that number decides whether 40 corpus conversations is enough: "8%, mostly work uniforms" is the piece working correctly, "30%, mostly unusable frames" means the framing or lighting is wrong.
- **MJPEG is still unverified.** It cannot be forced from the browser; `docs/day-one-measurements.md` has the `v4l2-ctl` procedure, and it has to run on the Pi.

---

## 6. Who does what next (assigned 2026-08-09)

**The principle.** Codex takes bounded fixes with mechanical acceptance criteria, in files it already authored. Claude takes the seams, the cross-window contracts, and anything that needs judgment about the piece.

That split follows directly from what the review found. Codex's code quality was not the problem — the gate parser, the occupancy model, and the state machine are all good. The problem was that nine agents each built to a contract and stopped at its edge, so nobody owned the joins. **Integration must not be re-partitioned into lanes.** One owner holds the whole picture or the same gap reappears one level up.

### 6.1 Codex — bounded fixes, parallel-safe — ✅ all eight landed, reviewed 2026-08-09

Verified independently rather than from the summary: typecheck clean over all 26 kiosk files (nothing excluded to make it pass), 51 tests green, both builds pass, `dist/eval/` absent while the mock clips still publish, and both shell scripts parse. Against a running server: `/content/offline-pool.json` returns all 40 conversations, `/config.json` falls back to the example, `/content/%2e%2e%2f…` is refused with 403, and a mock generation round-trips four alternating beats. The skip fixture returns `source: "offline"` with no sentinel text in the response — the §4 safety path holds end to end through real HTTP, not just in unit tests.

**One amendment made during review.** The camera-label unlock opened a throwaway `getUserMedia({video: true})` unconditionally. Both kiosk windows boot simultaneously, so both would have raced for the same default device, which V4L2 can refuse — turning a first-run convenience into a boot failure on the Pi. It now runs only when labels are actually missing, which is the first run and never again.

**Nit, not fixed:** `/content/*` serves the whole directory, so `writer-prompt.md` is fetchable. The server binds to loopback so this is local-only, but an allowlist of the three JSON files the kiosk actually needs would be tighter.



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

1. ✅ **`kiosk/src/bus.ts`** — the §2.3 contract now has one definition. `state.ts` and `present/types.ts` import it and keep their original names (`ConductorEvent`, `PresentationEvent`) as aliases. Adds an `isBusEvent` guard, because a follower that reloads mid-performance rejoins a live channel.
2. ✅ **Integration in `main.ts`** — conductor/follower split by role, detection feeding the state machine, the state machine calling the generation client, presentation rendering the envelope, pre-roll and offline pools loaded from `content/`, the watchdog installed, and `Presentation` completion driving `stateMachine.complete()`. The production bundle went from 6 modules to 19. `kiosk/src/integration.test.ts` exercises the whole graph: occupancy → generation → four beats alternating across two windows → SPENT, plus the failed-generation and visitor-leaves paths.
3. ✅ **ROI editor coordinate mapping** (§5.2 #1) — `clientToSource` / `sourceToClient` undo the mirror and `object-fit: cover`, exported as pure functions with tests, including the case that was silently wrong (a click on screen-left is source-right).
4. ✅ **Generation-failure fallback** (§5.2 #4) — the state machine takes an optional `fallback`; `main.ts` supplies the offline pool. With no fallback it now lands in SPENT rather than stranding in ARMED, so a still-occupied zone cannot retry in a tight loop.

**Found while integrating — not yet fixed:**

- **No timeout on `beat_done`.** If the roast window is closed or crashed, the conductor waits forever partway through a performance. It recovers when the visitor leaves (abort fires), so it is not fatal, but a follower-liveness timeout that finishes the sequence on the praise screen alone would match §8 better.
- **A saved ROI needs a page reload.** `installRoiEditor` persists to `localStorage`, but `VideoOccupancyDetector` exposes no `setRoi` passthrough, so the running detector keeps the old region. Fine if the on-site procedure says "save, then reload"; worth wiring properly before week 3.
- **`kiosk/src/watchdog.ts`** — moved out of `server/`, where it was browser code the server never imported.
5. ✅ **Provider implementation + live ordering check** — Workers AI wired, credentials set up, and the endpoint actually called. The check earned its keep: it found thinking mode returning empty content at 13–26s, and the alphabetical key ordering that now blocks lane C. Findings are recorded under lane C; the decision is §5.1.
6. ✅ **Prompt placement** — the writer prompt is a `system` message; code and `content/README.md` agree.
7. **Apply whichever §5.1 option is chosen**, then re-run `verify:provider` with a photograph to confirm vision and with-image latency.
8. **Lane G eval run and scoring**, once photographs exist and §5.1 is settled.
9. **Lane H grade tuning pass and wall label draft** — the label is blocked on the provider's retention terms.

### 6.3 Blocked on a human

See §5.1 and §5.2, which are the live list — kept in one place so the two do not drift. In short: the provider decision (and the retention terms the wall label depends on), the monitor inventory, eval photographs, and every measurement that needs the Pi.

---

## 7. Open questions (kiosk-relevant subset of spec §11)

- Monitor model/orientation — blocks final CSS layout numbers only; lane A should make layout resolution-agnostic.
- Whether praise-camera framing covers the standing zone — if it doesn't, the ROI editor (lane B) is the tool for finding that out fast on-site; no code contingency needed now.
- Beat count stays fixed at 4 (spec leans no on variable count) — lane D may hardcode 4 layers per screen.
