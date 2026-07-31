# Bosch AI Future Portraits

Hybrid Lite prototype for the Bosch Supplier Conference.

`Human Input → Local AI Read → AI Response → AI Direct → 3-2-1 Capture → AI Create → Collective Layer`

## Routes

- `/booth` — camera experience and Future Portrait creation
- `/wall` — live collective display
- `/booth?debug=true` — MediaPipe landmarks, live features, scores and state

## Local perception architecture

Continuous camera perception stays in the browser:

`Camera → MediaPipe Pose + Hand → Behavior Features → Gesture Rules → State Machine`

Gemini is optional and receives structured behavioral metadata only. It never
receives continuous video and never controls interaction transitions. The app
contains deterministic fallback copy for all 16 Primary × Secondary combinations.

Key modules:

- `camera/` — permission, status and final-frame capture
- `perception/` — MediaPipe Tasks and normalized observations
- `behavior/` — movement, proximity, cohesion and reusable features
- `gestures/` — deterministic Single, Pair and Group rules with debouncing
- `interaction/` — Secondary scoring and explicit interaction state machine
- `narrative/` — structured metadata client and deterministic fallbacks
- `debug/` — query-parameter developer overlay

## Setup

```bash
npm install
npm run models
npm run dev
```

Open <http://localhost:3000/booth> and <http://localhost:3000/wall>.

`npm run models` downloads the official MediaPipe Pose Lite and Hand Landmarker
models into `public/mediapipe/models/` and verifies their SHA-256 hashes. The
WASM runtime is already vendored in `public/mediapipe/wasm/`.

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

The state machine intentionally rejects direct `ACTION_TRACKING → COUNTDOWN`
transitions. A confirmed gesture first enters `POSE_READY`, shows a readiness
moment, and only then runs the explicit `3 → 2 → 1` countdown.
