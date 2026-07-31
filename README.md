# Bosch AI Future Portraits

Hybrid Lite prototype for the Bosch Supplier Conference.

`Human Input → Local AI Read → AI Response → AI Direct → 3-2-1 Capture → AI Create → Collective Layer`

## V1 direction

The agreed first version is a browser-only, full-screen AI mirror:

- local MoveNet MultiPose perception;
- three spatial zones with no mandatory Begin click and an approximately
  0.5-metre forward-step demo preset;
- an active capture group of 1–5 people;
- an ambient perception halo around each tracked participant;
- one instruction at a time;
- any active participant can raise one arm to start the visible countdown;
- capture, save and publishing to the collective wall are separate decisions.

The V1 demo flow is implemented. The local MoveNet MultiPose Lightning graph
and weight shards are now present in `public/models/movenet/`, so MoveNet is the
default live engine. The app still has an explicit MediaPipe Pose development
fallback if those files or the MoveNet runtime become unavailable.

## Project documents

- [`docs/design-progress-zh.md`](docs/design-progress-zh.md) — current product
  decisions and progress; source of truth when older recommendations conflict.
- [`docs/v1-implementation-roadmap-zh.md`](docs/v1-implementation-roadmap-zh.md)
  — step-by-step path from the current code to V1, with module boundaries and
  completion criteria.
- [`docs/implementation-log-zh.md`](docs/implementation-log-zh.md) — chronological
  implementation decisions, completed work, validation results and open items.
- [`docs/research/exhibition-photo-interaction-research-zh.md`](docs/research/exhibition-photo-interaction-research-zh.md)
  — research evidence, risks and the deferred study plan.

## Routes

- `/booth` — camera experience and Future Portrait creation
- `/wall` — live collective display
- `/booth?debug=true` — current perception landmarks, live features, scores and state

## Local perception architecture

Continuous camera perception stays in the browser. Both MoveNet and the
MediaPipe development fallback crop inference to the configured central
interaction space before zone classification:

`Camera → Interaction ROI → MoveNet MultiPose → Stable Tracks → Zone Classification → Active Group (1–5) → Raise-arm Rule → Safe State Machine → AI Mirror`

When the MoveNet model is absent:

`Camera → MediaPipe Pose fallback → the same normalized tracks, zones, rules and AI Mirror`

Gemini is optional and receives structured behavioral metadata only. It never
receives continuous video and never controls interaction transitions. The app
contains deterministic fallback copy for all 16 Primary × Secondary combinations.

Key modules:

- `camera/` — permission, status and final-frame capture
- `perception/` — model-independent pose observations, MoveNet loader and MediaPipe fallback
- `behavior/` — movement, proximity, cohesion and reusable features
- `gestures/` — deterministic raise-arm rule, initiator lock and hold stability
- `interaction/` — spatial zones, active group capacity and safe state machine
- `narrative/` — structured metadata client and deterministic fallbacks
- `debug/` — query-parameter developer overlay

## Setup

```bash
npm install
npm run models
npm run dev
```

Open <http://localhost:3000/booth> and <http://localhost:3000/wall>.

The MoveNet browser runtime is vendored in `public/vendor/movenet/`. Add the
MoveNet MultiPose Lightning `model.json` and all weight shards referenced by it
to `public/models/movenet/`. The official TensorFlow.js download link and exact
placement are documented in that folder.

Until those model files exist, the demo visibly reports the missing model and
uses the existing local MediaPipe pose model as a development fallback.

`npm run models` downloads that MediaPipe fallback model and the legacy Hand
Landmarker. The V1 interaction does not use fine-grained hand tracking.

If the model host is blocked by the corporate proxy, download the two official
files on an approved network using the URLs and hashes documented in
`public/mediapipe/models/README.md`.

For optional Gemini narrative enhancement, set `GEMINI_API_KEY`. The client
automatically uses local fallback copy if the key, network or response is unavailable.

## HTTPS / LAN camera

```bash
npm run dev:https
```

The HTTPS helper requires `openssl` and creates a local certificate in `.cert/`.

## Validation

```bash
npm run test:rules
npm run build
```

The current state machine rejects direct `ACTION_TRACKING → COUNTDOWN`
transitions. V1 will additionally keep validating active IDs, group size and
capture-zone presence throughout `POSE_READY` and `COUNTDOWN`.
