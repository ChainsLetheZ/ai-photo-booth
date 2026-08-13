# MediaPipe model assets

Run `npm run models` from the project root to download and SHA-256 verify:

- `pose_landmarker_lite.task`
- `hand_landmarker.task`

The models come from the official `mediapipe-models` Google Cloud Storage
bucket. They are intentionally served from this app at runtime so continuous
camera perception stays on-device and does not depend on a CDN.

Official files:

- Pose Lite: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
  - SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`
- Hand Landmarker: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`
  - SHA-256: `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`

If the corporate proxy blocks Google Cloud Storage, download the two official
files on an approved network and place them in this directory. The fetch script
documents and verifies the expected hashes.
