import express from "express";
import path from "path";
import cors from "cors";
import fs from "fs";
import os from "os";
import http from "http";
import https from "https";
import { execFile } from "child_process";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { WebSocket, WebSocketServer } from "ws";

import { wallConfig } from "./config/wallConfig";
import { PRINT_6INCH_SERVER } from "./constants";
import { ensureHttpsCert } from "./scripts/ensure-https-cert.mjs";
import { WallRepository } from "./services/wallRepository";
import type { WallEntrySubmission, WallSocketMessage } from "./types";

const MAX_PORTRAIT_DATA_LENGTH = 4_000_000;
const ALLOWED_PRIMARY = ["Motion", "Intelligence", "Life", "Impact"];
const ALLOWED_SECONDARY = [
  "Collaboration",
  "Precision",
  "Momentum",
  "Exploration",
];

function isWallEntryDraft(value: unknown): value is WallEntrySubmission {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<WallEntrySubmission>;
  return (
    typeof draft.id === "string" &&
    typeof draft.photoUrl === "string" &&
    draft.photoUrl.startsWith("data:image/") &&
    draft.photoUrl.length <= MAX_PORTRAIT_DATA_LENGTH &&
    typeof draft.thumbUrl === "string" &&
    draft.thumbUrl.startsWith("data:image/") &&
    draft.thumbUrl.length <= MAX_PORTRAIT_DATA_LENGTH &&
    ALLOWED_PRIMARY.includes(draft.primaryEnergy ?? "") &&
    ALLOWED_SECONDARY.includes(draft.secondaryDimension ?? "") &&
    typeof draft.narrativeLine === "string" &&
    Number.isInteger(draft.personCount) &&
    Number(draft.personCount) >= 1 &&
    Number(draft.personCount) <= 5 &&
    Array.isArray(draft.poseTrace) &&
    draft.poseTraceVersion === 2 &&
    (draft.requestedShortCode === undefined ||
      /^\d{3}$/.test(draft.requestedShortCode))
  );
}

function lanIpv4s() {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function wantsHttps() {
  if (process.env.HTTPS === "0" || process.env.HTTPS === "false") return false;
  if (process.env.HTTPS === "1" || process.env.HTTPS === "true") return true;
  return process.argv.includes("--https");
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const useHttps = wantsHttps();
  const wallRepository = new WallRepository(
    path.resolve(
      process.cwd(),
      process.env.WALL_DATA_FILE || wallConfig.persistenceFile,
    ),
  );
  let wallWebSocket: WebSocketServer | null = null;

  const broadcastWallMessage = (message: WallSocketMessage) => {
    const payload = JSON.stringify(message);
    wallWebSocket?.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  };

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // Optional LLM enhancement. This endpoint accepts behavioral metadata only;
  // no image, video frame or identity data is sent to Gemini.
  app.post("/api/narrative", async (req, res) => {
    const {
      primaryEnergy,
      secondaryDimension,
      groupSize,
      groupMode,
      behavior,
    } = req.body ?? {};
    const allowedPrimary = ["Motion", "Intelligence", "Life", "Impact"];
    const allowedSecondary = [
      "Collaboration",
      "Precision",
      "Momentum",
      "Exploration",
    ];
    if (
      !allowedPrimary.includes(primaryEnergy) ||
      !allowedSecondary.includes(secondaryDimension) ||
      !Number.isInteger(groupSize) ||
      groupSize < 0 ||
      groupSize > 20 ||
      !["Single", "Pair", "Group"].includes(groupMode) ||
      !behavior ||
      typeof behavior !== "object"
    ) {
      return res.status(400).json({ error: "Invalid narrative metadata" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "Narrative enhancement unavailable" });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const metadata = {
        primaryEnergy,
        secondaryDimension,
        groupSize,
        groupMode,
        behavior: {
          groupCohesion: Number(behavior.groupCohesion) || 0,
          movementIntensity: Number(behavior.movementIntensity) || 0,
          movementSynchrony: Number(behavior.movementSynchrony) || 0,
          handsConverged: Boolean(behavior.handsConverged),
          armsOpen: Boolean(behavior.armsOpen),
        },
      };
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        contents: [
          "Create concise, brand-safe English copy for a Bosch conference future portrait.",
          "Return JSON only with keys: label, response, directionCopy, imagePromptVariables.",
          "imagePromptVariables must contain visualTheme and composition strings.",
          "Do not infer identity, personality, emotion, age, gender, or any sensitive trait.",
          `Observable metadata: ${JSON.stringify(metadata)}`,
        ].join("\n"),
        config: {
          responseMimeType: "application/json",
          temperature: 0.5,
        },
      });
      const output = JSON.parse(response.text ?? "{}");
      res.json(output);
    } catch (error) {
      console.error("Narrative generation failed:", error);
      res.status(502).json({ error: "Narrative generation failed" });
    }
  });

  // Persistent booth → server → wall contract. A WebSocket connection receives
  // a full sync first, then entry_added events for lossless reconnects.
  app.get("/api/wall/entries", (_req, res) => {
    res.json(wallRepository.list());
  });

  app.post("/api/wall/codes", (req, res) => {
    const id = req.body?.id;
    const requestedShortCode = req.body?.requestedShortCode;
    if (
      typeof id !== "string" ||
      (requestedShortCode !== undefined &&
        (typeof requestedShortCode !== "string" ||
          !/^\d{3}$/.test(requestedShortCode)))
    ) {
      return res.status(400).json({ error: "Invalid wall code request" });
    }
    try {
      res.json({ shortCode: wallRepository.reserve(id, requestedShortCode) });
    } catch (error) {
      if (error instanceof Error && error.message === "WALL_CAPACITY_REACHED") {
        return res.status(409).json({ error: "Wall capacity reached" });
      }
      console.error("Wall code reservation failed:", error);
      res.status(500).json({ error: "Unable to reserve wall code" });
    }
  });

  app.post("/api/wall/entries", (req, res) => {
    if (!isWallEntryDraft(req.body)) {
      return res.status(400).json({ error: "Invalid wall entry" });
    }
    try {
      const { entry, added } = wallRepository.add(req.body);
      if (added) broadcastWallMessage({ type: "entry_added", entry });
      res.status(added ? 201 : 200).json(entry);
    } catch (error) {
      if (error instanceof Error && error.message === "WALL_CAPACITY_REACHED") {
        return res.status(409).json({ error: "Wall capacity reached" });
      }
      console.error("Wall persistence failed:", error);
      res.status(500).json({ error: "Unable to persist wall entry" });
    }
  });

  // Existing silent-print bridge retained for the event printer.
  app.post("/api/print", (req, res) => {
    const { imageBase64, printerName, printSize } = req.body;
    if (typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "No imageBase64 provided" });
    }

    try {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const tempFilePath = path.join(os.tmpdir(), `bosch_portrait_${Date.now()}.jpg`);
      fs.writeFileSync(tempFilePath, base64Data, "base64");

      const isWindows = os.platform() === "win32";
      const safePrinter =
        typeof printerName === "string" && /^[\w .()#-]{1,120}$/.test(printerName)
          ? printerName
          : undefined;

      if (isWindows) {
        const args = safePrinter ? ["/pt", tempFilePath, safePrinter] : ["/p", tempFilePath];
        execFile("mspaint", args, onPrintComplete);
      } else {
        const args: string[] = [];
        if (safePrinter) args.push("-P", safePrinter);
        if (printSize === PRINT_6INCH_SERVER.media || printSize === "6x4") {
          args.push("-o", `media=${PRINT_6INCH_SERVER.media}`);
        }
        args.push(tempFilePath);
        execFile("lpr", args, onPrintComplete);
      }

      function onPrintComplete(error: Error | null) {
        if (error) console.error(`Print error: ${error.message}`);
        setTimeout(() => fs.unlink(tempFilePath, () => undefined), 10000);
      }

      res.json({
        success: true,
        message: "Print job submitted to queue.",
        size: printSize || PRINT_6INCH_SERVER.media,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Print failed";
      res.status(500).json({ error: message });
    }
  });

  let server: http.Server | https.Server;
  if (useHttps) {
    const { keyPath, certPath, ips, reused } = ensureHttpsCert();
    server = https.createServer(
      {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
      app,
    );
    console.log(reused ? `TLS: reusing ${keyPath}` : `TLS: generated cert for ${ips.join(", ")}`);
  } else {
    server = http.createServer(app);
  }

  wallWebSocket = new WebSocketServer({ noServer: true });
  wallWebSocket.on("connection", (socket) => {
    socket.on("error", () => undefined);
    const sync: WallSocketMessage = {
      type: "sync",
      entries: wallRepository.list(),
    };
    socket.send(JSON.stringify(sync));
  });
  server.on("upgrade", (request, socket, head) => {
    const requestPath = new URL(
      request.url ?? "/",
      `${useHttps ? "https" : "http"}://${request.headers.host ?? "localhost"}`,
    ).pathname;
    if (requestPath !== wallConfig.websocketPath) return;
    wallWebSocket?.handleUpgrade(request, socket, head, (client) => {
      wallWebSocket?.emit("connection", client, request);
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const proto = useHttps ? "https" : "http";
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on ${proto}://localhost:${port}`);
    console.log(`  Booth: ${proto}://localhost:${port}/booth`);
    console.log(`  Wall:  ${proto}://localhost:${port}/wall`);
    for (const ip of lanIpv4s()) {
      console.log(`  LAN Booth: ${proto}://${ip}:${port}/booth`);
      console.log(`  LAN Wall:  ${proto}://${ip}:${port}/wall`);
    }
    if (useHttps) {
      console.log("Note: self-signed certificate - the browser may show a warning.");
      console.log("Camera access on phones/tablets requires HTTPS (or localhost).");
    }
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
