# Mosaic wall — colleague's earlier solution (reference copy)

Copied 2026-08-05 from `ML4-photo-2-main`. **Not wired into this app.** These files
are excluded from `tsconfig.json` and the Vite build: they use Tailwind utility
classes and a `firebase/compat` data layer, neither of which exists here, so they
will not compile or render as-is.

They are here to be read and ported from, not imported.

## What is where

| File | Why it is worth keeping |
|---|---|
| `components/MosaicView.tsx` | The wall itself. Diagonal infinite pan, and the `A` key assemble that flies every tile into the shape of the event slogan. `sampleSloganTargets()` is the interesting part — it rasterises the slogan to an offscreen canvas and reads the alpha channel to get target points. |
| `components/PhotoBooth.tsx` | Selfie-segmentation cutout over a branded background, and `captureFromPreview()` which renders a 1800×1200 6×4 print frame. |
| `services/printService.ts` + `server.ts` | Silent 6×4 printing. The server exposes `POST /api/print`; Windows goes through `mspaint /pt`, other platforms through `lpr`. |
| `services/audioService.ts` | Event sound design. |
| `components/Gallery.tsx` | Operator view: multi-select, batch download, delete, bulk import. |
| `services/dataService.ts` | Firebase Realtime Database sync. See the caveats below before reusing. |

## Read these before porting the data layer

- `dataService.ts` contains a live Firebase config, so this repo now carries it too.
- `subscribe()` uses `on('value')` on the whole `participants` node, so every new
  photo re-sends every existing photo to every client — quadratic over the event.
- Records store the full 1800×1200 JPEG as a base64 data URL, ~0.5–1 MB each.
- `WallEntry` in this project already separates `thumbUrl` from `photoUrl` and
  already persists `poseTrace` and `personCount`, none of which the mosaic data
  model has. Port the assemble behaviour onto `services/wallRepository.ts`
  rather than moving this project onto Firebase.

## Assets taken from the same project

- `public/kv/kv-supplier-day-2026.png` — event KV, usable as the `--kv-image` backdrop
- `public/kv/booth-bg.png` — cutout background plate
- `public/mediapipe/models/selfie_segmenter*.tflite` — segmentation models
