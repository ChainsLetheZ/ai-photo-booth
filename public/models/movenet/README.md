# Local MoveNet MultiPose Lightning model

The application expects a locally hosted TensorFlow.js MoveNet MultiPose
Lightning graph model at:

```text
public/models/movenet/model.json
```

Official TensorFlow Hub download:

https://tfhub.dev/google/tfjs-model/movenet/multipose/lightning/1?tfjs-format=compressed

This is the TensorFlow.js archive, not the similarly named SavedModel or TFLite
download. Extract the archive directly into this folder.

Place `model.json` and every shard referenced by its `weightsManifest` in this
folder. Keep the filenames exactly as referenced by the JSON file.

The TensorFlow.js and pose-detection browser runtimes are already vendored in
`public/vendor/movenet/`; no CDN is required at runtime.

When the model is absent, the demo reports that MoveNet is not installed and
uses the existing local MediaPipe pose model as an explicit development
fallback. Continuous camera frames remain on the device in both modes.
