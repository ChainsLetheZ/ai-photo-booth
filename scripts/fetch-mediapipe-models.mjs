import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const models = [
  {
    name: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    sha256: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
  },
  {
    name: "hand_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    sha256: "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1",
  },
];

const outputDirectory = path.resolve("public", "mediapipe", "models");
fs.mkdirSync(outputDirectory, { recursive: true });

for (const model of models) {
  const outputPath = path.join(outputDirectory, model.name);
  if (fs.existsSync(outputPath)) {
    const existingHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(outputPath))
      .digest("hex");
    if (existingHash === model.sha256) {
      console.log(`${model.name}: already verified`);
      continue;
    }
    throw new Error(`${model.name}: existing file has an unexpected SHA-256`);
  }

  console.log(`${model.name}: downloading`);
  const response = await fetch(model.url);
  if (!response.ok) {
    throw new Error(`${model.name}: download failed (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (hash !== model.sha256) {
    throw new Error(`${model.name}: SHA-256 mismatch (${hash})`);
  }
  fs.writeFileSync(outputPath, bytes);
  console.log(`${model.name}: verified and saved`);
}
