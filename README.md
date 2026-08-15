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
- **The prompt has never seen a photograph.** The provider works — Kimi K2.7 on Cloudflare Workers AI (`@cf/moonshotai/kimi-k2.7-code`), 5/5 in gate order, 3.2s median against a 5.5s budget — but every call so far has been text-only. Vision is the one assumption the design rests on that is still unexercised.
- **No beat has been judged.** The eval set has no images and nothing has been scored.
- **Nothing has touched the hardware.** No Raspberry Pi, no cameras, no latency or thermal measurements.

`IMPLEMENTATION_PLAN.md` §5 is the live list of what's left. The gallery show is real and the install window is short.

---

## Quick start

You need Node 22.9 or newer — the scripts run TypeScript directly and load `.env`
through Node's own flags — and a Chromium-based browser. Nothing else: the first
path below has no camera, no API key, and no hardware in it.

```sh
npm install
npm run dev
```

That starts the API with mock generation, starts Vite, and opens both roles in a browser using looping video clips instead of cameras. You should see the praise screen greet you, then four beats alternate between the windows. `Ctrl-C` stops both processes.

If no Chromium is found it prints the two URLs instead — open them in separate windows, praise first, and put them side by side. Both roles must be running: the praise window conducts and the roast window will sit idle on its own.

From there the path widens in two steps, each its own section below: [the real model](#running-against-the-real-model) in place of mock generation, then [a desk rehearsal](#rehearsing-on-a-desk) with two real cameras, which is the whole piece minus the Pi.

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

### Running against the real model

```sh
cp .env.example .env      # then fill in the two Cloudflare values
npm run verify:provider -- path/to/a/photo.jpg
```

`.env` is gitignored, and everything that needs credentials loads it automatically
through Node's `--env-file-if-exists` — nothing to export, nothing to remember per
shell. Get both values from the dashboard under **AI → Workers AI → Use REST API**:
it shows the Account ID and offers **Create a Workers AI API Token**, prefilled with
the right permissions. A hand-rolled token needs **both** Workers AI *Read* and
*Edit* — inference counts as Edit. Give it an expiry past the show, and never use the
Global API Key: the Pi is a physical device in a public room.

Three things keep it out of git, in increasing order of reliability: `.gitignore`, a
`pre-commit` hook installed automatically by `npm install` (bypass with `--no-verify`),
and GitHub push protection, which is already enabled on this repo and blocks a
recognised Cloudflare token server-side even from a machine that never ran the hook.

Do that **before** wiring it into a show. The piece makes one structured call whose
gate fields must arrive before the beats (see below), and Cloudflare states that
Workers AI cannot guarantee a model follows the requested schema — so the assumption
is checked, not trusted. The script runs the real parser five times and reports order
stability, whether the image was accepted, and latency against the timeout. Use
`--no-image` to check ordering and credentials without a photograph.

Then start the server without `MOCK_GENERATION=1`. `GENERATION_PROVIDER=openai` plus
`OPENAI_API_KEY` still works if you need to compare.

### Rehearsing on a desk

Two USB webcams and one wide monitor reproduce the whole piece before any Pi exists.
Same build, same server, same model, same launcher as the show — only the window
geometry differs, so what gets rehearsed is the thing that ships.

```sh
cp config.example.json config.json     # gitignored, per-machine
npm run rehearse                       # build both, serve on :4173, real model
npm run screens                        # two windows, side by side
```

`npm run screens` calls `chromium`; if the machine has Chrome under another name,
`CHROMIUM_BIN=google-chrome npm run screens`. Unlike `npm run dev` it does not go
looking, because on the Pi the browser is pinned deliberately.

Camera selectors are the only thing to fill in. Leave them as the placeholders on the
first run: each window fails to boot and prints the cameras it can actually see, with
the browser's own names and deviceIds. Copy one into `cameras.praise` and the other
into `cameras.roast`, then reload.

**Two cameras of the same model need deviceIds.** Chromium labels a camera by product
name and USB vid:pid — `HD Pro Webcam C920 (046d:08e5)` — and not by serial, so a
matched pair is indistinguishable by label. deviceIds are salted per browser profile
and the two windows run separate profiles, so take each role's value from that role's
own window. Each window only resolves its own.

Selection is never by enumeration order. That would silently swap the two mirrors on
the next reboot, and the piece cannot notice it is flattering the wrong feed.

A word on USB: a C920 draws ~500mA, essentially a full bus-powered port, and two of
them behind one unpowered hub will not both enumerate. Separate motherboard ports are
the reliable arrangement. `lsusb -t` shows what actually came up; two `/dev/video*`
nodes are one camera, not two — the second is its metadata node.

Point the praise camera slightly *above* eye level and the roast camera low and
off-axis. That difference is the piece, and it is the part a desk rehearsal can get
wrong without looking wrong.

Then stand in front of it. `?roi=1` on the praise window redraws the detection region
by clicking four corners, which is the setting most worth tuning at desk scale and
again on site.

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
