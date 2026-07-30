# Bosch AI Future Portraits

Hybrid Lite prototype for the Bosch Supplier Conference.

The experience follows:

`Human Input → AI Read → AI Response → AI Direct → 3-2-1 Capture → AI Create → Collective Layer`

## Routes

- `/booth` — camera experience and Future Portrait creation
- `/wall` — live collective display

The booth posts completed portraits to the local Express server. The wall receives
new records over Server-Sent Events. `localStorage` and `BroadcastChannel` provide
a same-device fallback.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000/booth> and <http://localhost:3000/wall>.

For camera access from another device on the LAN:

```bash
npm run dev:https
```

The HTTPS helper requires `openssl` and creates a local certificate in `.cert/`.

## Prototype behavior

- Primary Energy is touch-first: Motion, Intelligence, Life, or Impact.
- Face count uses the browser `FaceDetector` API when available and falls back to
  Single mode.
- Gesture readiness is based on movement followed by a held pose. A visible touch
  fallback is always available.
- Future Portrait and Co-Creation Card are composed locally in Canvas.
- Event-session results are in memory and capped at 48 records.
