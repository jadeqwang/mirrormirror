# mirrormirror

One mirror always roasts you. The other always compliments you. Haunted museum artifact.

Two screens stand side by side at human scale. A visitor steps in front of them and sees themselves on both. The screens then talk — to the visitor and to each other — and they do not agree.

**The turn:** they are not showing the same picture. The roast screen shows a plain, honestly flipped camera feed from a low, off-axis angle nobody would choose for themselves. The praise screen shows a quietly beautified one — warm grade, soft-focus falloff, bloom, vignette — shot from slightly above eye level. So the mirror that flatters you is the one distorting you, and the cruel one is the only one telling the truth.

The wall label does not explain that. Neither should anything else in the room.

---

## Status

The loop closes in software. A trigger runs detection → state machine → one generation call → four beats alternating across two windows → back to idle, and that path is covered by tests along with the failed-generation and visitor-leaves-mid-performance branches.

Being straight about what that does *not* mean:

- **It has never been run in a browser.** Nobody has opened two windows and watched a performance.
- **No beat has ever come from a real model.** Everything so far runs against mocks.
- **The model provider is undecided.** The default is OpenAI-shaped because it was chosen while implementing, not because anyone picked it. Hence `OPENAI_API_KEY` below.
- **Nothing has touched the hardware.** No Raspberry Pi, no cameras, no latency or thermal measurements.

`IMPLEMENTATION_PLAN.md` §5 is the live list of what's left. The gallery show is real and the install window is short.

---

## Running it

```sh
npm install
npm run dev
```

That starts the API with mock generation, starts Vite, and opens both roles in a browser using looping video clips instead of cameras — no webcam, no API key, no hardware. You should see the praise screen greet you, then four beats alternate between the windows.

```sh
npm test         # unit + integration tests
npm run typecheck
npm run build && npm run build:server
```

Useful URL parameters, all on the kiosk app:

| Parameter | Effect |
| --- | --- |
| `?screen=praise` / `?screen=roast` | **Required.** Picks the role. Praise is the conductor. |
| `?debug=1` | Overlay with fps, resolution, dropped frames, decode time, main-thread lag |
| `?roi=1` | Four-click editor for the detection region, for use on site |
| `?mock_camera=1` | Use a fixture clip instead of a camera |
| `?mock_scene=empty-room\|one-person\|three-people` | Which clip |

`F9` re-arms the piece by hand — deliberately obscure, and there for the attendant on opening night when detection does something nobody predicted.

To run against a real model, set `OPENAI_API_KEY` and start the server without `MOCK_GENERATION=1`. See the provider caveat above before assuming that is the right endpoint.

---

## How it works

Two processes.

**`server/`** is a small Node service. It holds the API key, makes the one structured vision-and-writer call, runs the deny-list, and serves the app. It is deliberately dumb: no state machine, no detection, no timing. If it restarts mid-performance the kiosk falls back to a canned conversation and nobody notices.

**`kiosk/`** is a static web app loaded twice, once per display. The praise window is the conductor — it owns the camera the detector samples, the state machine, and the generation call. The roast window is a follower that renders only the beats addressed to it and reports when it has finished typing. They speak over one `BroadcastChannel` and nothing else.

Presence detection samples the praise camera's existing video element into a 160×120 canvas a few times a second and compares it against a slowly learned background inside a hand-drawn region. No second camera, no face detection, no neural network — presence and count only, and the background model freezes while the screens are performing so their own light doesn't register as a visitor.

## The part not to break

The piece makes one model call that both looks at the visitor and writes the jokes. That is a real safety compromise, and it is only survivable because of three things working together:

1. **The gate is decided before the beats are read.** The model emits `skip` before it emits `beats`, the parser reads them in that order, and on a skip the beats are discarded *without ever being parsed*. Not filtered afterwards — never read.
2. **A deny-list runs server-side** over beat text before anything reaches a screen, as a backstop for the gate rather than a substitute.
3. **The skip conditions are broad**, and they apply to the praise side exactly as much as the roast side. Gushing about someone's outfit while they're in work uniform lands as badly as mocking it.

The failure being defended against is not the model naming a mobility aid. It's the model *alluding* to one — "you seem very grounded" — which reads as the machine being coy about a stranger's body, and is worse than being tactless. `content/writer-prompt.md` explains this at length because it is the whole ballgame.

Frames exist in memory only, long enough to make one request. Nothing is written to disk, logged, or retained.

---

## Layout

```
content/     the writer prompt, deny-list, 40 fallback conversations, pre-roll pool
kiosk/src/   the app: video, detection, state machine, presentation, the bus
server/      the one call, the safety gate, static serving
ops/         systemd units, Pi provisioning, Chromium launch
fixtures/    mock clips, mock envelopes, the writer-prompt eval set
docs/        day-one measurement procedures
```

Worth reading before changing anything:

- **`Mirror Mirror — Project Spec v0.3.md`** — the source of truth. It marks decisions already made, most of which have a stated reason.
- **`IMPLEMENTATION_PLAN.md`** — architecture, frozen contracts, current status, what's left.
- **`content/README.md`** — how the prompt and pools fit together, and two places the spec contradicts itself.
- **`fixtures/eval/README.md`** — how the writer prompt gets judged, and why photographs of real people are not in this repo.

Hardware, provisioning, and the gallery-day checklist live in `ops/README.md`.

## License

MIT — see `LICENSE`.
