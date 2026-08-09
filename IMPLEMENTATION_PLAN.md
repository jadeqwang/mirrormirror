# Mirror Mirror — Implementation Plan v1

**Source of truth:** `Mirror Mirror — Project Spec v0.3.md`. If this plan and the spec disagree, the spec wins. Read the spec's "Decisions already made" framing before proposing alternatives — most obvious ideas were already rejected for stated reasons.

**Audience:** a heterogeneous pool of agents (gpt-5.6-sol, Opus 5, Sonnet, Fable) working concurrently. This doc exists so you can pick up a workstream cold, without talking to the other agents. The mechanism that makes that safe is **frozen contracts** (§2) plus **file ownership** (§3). Do not edit files outside your workstream's ownership list; do not change a frozen contract without updating this doc and flagging it in your PR title with `[CONTRACT]`.

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

### A. Kiosk shell + video pipeline **[spec'd]**
Two-window boot, camera acquisition, MJPEG forcing, mirroring, praise-side grade.

- Chromium launch scripts: two kiosk windows, one per display, correct URL params. (Actual display placement lives in lane F's boot scripts; here, just make the app run given a window.)
- `getUserMedia` with explicit `deviceId`; a `config.json` maps role → camera by **device path/serial**, never enumeration order (spec §2 gotchas).
- Constraints: MJPEG, 720p, 20–24fps. Verify actual negotiated format and expose it in the debug overlay (lane A owns a `?debug=1` overlay showing fps, resolution, format, CPU-ish timing stats).
- Both feeds mirrored horizontally.
- Praise grade per spec §3: CSS `filter` chain (saturate/contrast/brightness/slight sepia), radial-gradient vignette overlay, duplicated-blurred-layer bloom, radial-masked blurred underlay for soft-focus falloff. Ship it parameterized (CSS custom properties driven from `config.json`) so lane H can tune without touching code. **Photographic only — no landmark/geometry warping, ever** (spec §9).
- Deliverable includes the **day-one measurement harness**: a documented procedure + debug-overlay support for the stopwatch latency test and the 30-minute full-load CPU/thermal test (spec §3). These are make-or-break; build the harness first.

### B. Detection + state machine **[spec'd]**
Runs in the praise (conductor) window only.

- Occupancy gate exactly per spec §6: 160×120 offscreen canvas at 3–4fps from the praise `<video>`, grayscale running-average background model, foreground fraction inside an ROI trapezoid, hysteresis on both edges, background model **frozen during PERFORMING**. Web Worker + `OffscreenCanvas` where supported.
- ROI is hand-drawn: build a `?roi=1` editor mode (click to place trapezoid corners, persisted to `localStorage` + exportable into `config.json`). This gets used in the gallery in week 3 — make it usable by a human under time pressure.
- State machine: `EMPTY → ARMED (1.5s settle) → PERFORMING (locked) → SPENT → EMPTY` with every rule in spec §6: fire generation at ARMED entry, ignore arrivals during PERFORMING, abort+fade if zone clears mid-sequence, SPENT requires 4–5s empty, hidden keyboard re-arm key for the attendant.
- Emits events on the contract in §2.3. Does **not** render anything and does **not** call the network directly — it asks lane C's client.
- No second `getUserMedia`, no face detection, no extra processes (spec §6 is explicit).

### C. Generation client + safety gating **[deep — safety-critical parsing order]**
The kiosk-side client and server-side endpoint for the ONE call.

- Server endpoint `POST /generate` (contract §2.2): accepts a JPEG frame + group-size-unknown flag, calls the vision+writer model with **structured output, field order enforced** (gate fields before beats — spec §4 Mitigation 1), returns the parsed envelope.
- **Parsing order is a safety property:** server parses `skip` first; if true, `beats` is discarded server-side and never sent to the kiosk. The kiosk never sees skipped text.
- Server runs the **deny-list regex backstop** (lane G authors the list; C wires it) over beat text before responding. A deny-list hit converts the response to `skip: true, skip_reason: "denylist"`.
- Kiosk client: fire at ARMED, timeout at 6s, on timeout/error/skip pull a conversation from the **offline pool** (lane G authors; C implements loader + no-repeat shuffle).
- Also implement frame capture: praise `<video>` → canvas → JPEG blob, in-memory only, no disk writes, no logging of image data (spec §9 retention promise must stay literally true — do not add "helpful" debug frame dumps).

### D. Presentation layer **[spec'd, but timing feel matters — Sonnet fine, get I to review on hardware]**
Everything the visitor reads.

- Typewriter reveal, character by character; strict alternation (one screen types while the other holds); accumulate-don't-replace with prior beats dimmed to ~40%; white on black over video (spec §7).
- Pre-roll beat: on ARMED, praise screen instantly types a canned two-word acknowledgment from a small local pool; generated beats then start as beat 2 (spec §7). This must be instant — no network, no awaits.
- Beat routing: consume the envelope (§2.1), render `screen: praise` beats locally, forward `screen: roast` beats over the BroadcastChannel per §2.3.
- Abort path: mid-sequence fade-out (zone cleared) that doesn't look like a crash.
- Total reveal budget ~18–25s for four beats; expose per-character delay + inter-beat gaps in `config.json` for tuning.

### E. Server + reliability **[spec'd]**
- The Node server itself: static file serving, `/generate`, `/health`, config loading, env-var API key.
- systemd units with auto-restart for server and kiosk; Chromium crash → relaunch. Restart behavior lands **before** anything is built on top (spec §8).
- Pi provisioning script/notes: boot-to-kiosk (no desktop chrome, no cursor, no update nags), Ethernet config, verifying both HDMI outs enumerate as independent displays, pinning webcams by path.
- SD image checklist for the cold spare.
- A blank screen is the only visitor-perceivable failure (spec §8) — add a kiosk-side watchdog: if the video element stalls >5s, hard-reload the window.

### F. Dev harness / fake hardware **[spec'd — do this FIRST, it unblocks everyone]**
Most agents won't have a Pi, two C920s, or two displays. Build the substitute layer:

- `MOCK_CAMERA=1` mode: kiosk uses looping video files (check into `fixtures/`, a few clips of one person / three people / empty room) via `captureStream()` in place of `getUserMedia`.
- `MOCK_GENERATION=1` mode: server returns canned envelopes (normal, skip, malformed, slow) from `fixtures/envelopes/`.
- Two-browser-window dev mode on a laptop (`npm run dev` opens both roles).
- Unit-test scaffolding: state machine transitions and envelope parsing are the two things that must have real tests (they encode the safety and behavior rules). Detection thresholds and CSS grades are tuned by eye, not tested.

### G. Writer prompt + safety content + offline pool **[deep — this is the piece. Fable/Opus only]**
The spec is explicit (§10): this and filter tuning decide whether the piece reads as slick or as a hackathon project.

- **The writer prompt.** Must produce: gate-fields-first structured output; the four-beat setup→counter→escalation→button structure with beats 3–4 referencing 1–2; 8–15 words per beat; ~70% roast-last, praise-last kept in the mix; the **disagreement device at least once per performance (hard requirement)**; shared-subject rule; anti-mechanical-symmetry instructions; tone rules (effort/coherence not objects, no body commentary, garment+color descriptors only, cap 3 named individuals, group-as-mass past 3); the full skip-condition superset (religious/cultural dress, mobility aids, medical devices, uniforms/scrubs, anything reading as protected category — praise side filtered same as roast side).
- **Test it against real photos of varied outfits** — including cases that must skip and cases that must not allude. The failure mode to hunt is the coy allusion ("you seem very grounded") described in spec §4. Build a small eval set (photos + expected skip/no-skip + notes) into `fixtures/eval/`; lane C's mock mode can replay it.
- **Deny-list regex** (Mitigation 2): ~10 lines, obvious-miss backstop, with comments explaining each entry.
- **Offline pool:** ~40 pre-generated four-beat conversations, situational/self-referential only, zero wardrobe references (spec §8). Also the pre-roll acknowledgment pool (~10 two-word lines).
- Deliverables are data files (`content/writer-prompt.md`, `content/denylist.json`, `content/offline-pool.json`, `content/preroll-pool.json`) — no code, so this lane never merge-conflicts with A–F.

### H. Visual grade tuning + wall label **[deep-ish — needs taste; Opus/Fable or a human]**
- Tune the praise-side grade parameters (via lane A's CSS custom properties): subtle enough not to be clocked immediately, strong enough to notice on a glance between screens (spec §7). Do a first pass on mock video; final tuning is on-site by a human — document the knobs and sane ranges in `content/grade-tuning.md`.
- Draft wall label text per spec §9: states the piece comments on appearance; notes incidental background capture; states no images/data recorded or retained (verify against the actual API provider's retention terms before finalizing — flag this as a human task).

### I. Integration + hardware bring-up **[one agent, or the human + one agent, serially]**
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

## 5. Open questions (kiosk-relevant subset of spec §11)

- Monitor model/orientation — blocks final CSS layout numbers only; lane A should make layout resolution-agnostic.
- Whether praise-camera framing covers the standing zone — if it doesn't, the ROI editor (lane B) is the tool for finding that out fast on-site; no code contingency needed now.
- Beat count stays fixed at 4 (spec leans no on variable count) — lane D may hardcode 4 layers per screen.
