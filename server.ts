import express from "express";
import path from "path";
import cors from "cors";
import fs from "fs";
import os from "os";
import http from "http";
import https from "https";
import { execFile, spawn } from "child_process";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { WebSocket, WebSocketServer } from "ws";

import { wallConfig } from "./config/wallConfig";
import { PRINT_6INCH_SERVER } from "./constants";
import { ensureHttpsCert } from "./scripts/ensure-https-cert.mjs";
import { WallRepository } from "./services/wallRepository";
import { WALL_MEDIA_ROUTE, wallMediaDirectory } from "./services/wallMedia";
import type { WallEntrySubmission, WallSocketMessage } from "./types";

// Keep deployment credentials on the booth computer, never in the browser
// bundle. Vite also reads this file for VITE_* public values only.
const localEnvPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(localEnvPath)) {
  for (const line of fs.readFileSync(localEnvPath, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// This limit protects the local booth process only. In CloudBase mode the
// images are decoded here and uploaded directly to storage, so they never
// enter the cloud function's 6 MB request envelope.
const MAX_PORTRAIT_DATA_LENGTH = 20_000_000;
const CLOUDBASE_PHOTO_API =
  "https://uxgs-d4gv4c7qr60f22622-1317468313.ap-shanghai.app.tcloudbase.com/photo-booth";
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
    typeof draft.imageUrl === "string" &&
    draft.imageUrl.startsWith("data:image/") &&
    draft.imageUrl.length <= MAX_PORTRAIT_DATA_LENGTH &&
    (draft.sourceImageUrl === undefined ||
      (typeof draft.sourceImageUrl === "string" &&
        draft.sourceImageUrl.startsWith("data:image/") &&
        draft.sourceImageUrl.length <= MAX_PORTRAIT_DATA_LENGTH)) &&
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
  const wallDataFile = path.resolve(
    process.cwd(),
    process.env.WALL_DATA_FILE || wallConfig.persistenceFile,
  );
  const wallRepository = new WallRepository(wallDataFile);
  const uploadToken = process.env.PHOTO_BOOTH_UPLOAD_TOKEN || '';
  const useCloudBase = process.env.PHOTO_BOOTH_CLOUD_SYNC === 'true';
  const cloudProxyUrl = process.env.PHOTO_BOOTH_HTTPS_PROXY || '';
  let wallWebSocket: WebSocketServer | null = null;

  const curlRequest = async (
    target: string,
    method: string,
    headers: string[],
    body?: string | Buffer,
  ) => {
    return new Promise<{ status: number; text: () => Promise<string> }>((resolve, reject) => {
      const args = [
        '--silent', '--show-error', '--write-out', '\n%{http_code}',
        '--request', method,
        '--header', 'Expect:',
        ...headers.flatMap((header) => ['--header', header]),
        ...(cloudProxyUrl ? ['--proxy', cloudProxyUrl] : []),
        ...(body !== undefined ? ['--data-binary', '@-'] : []),
        target,
      ];
      const request = spawn('curl', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      request.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
      request.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
      request.on('error', reject);
      request.on('close', (code) => {
        const output = Buffer.concat(stdout).toString('utf8');
        const split = output.lastIndexOf('\n');
        const value = split >= 0 ? output.slice(0, split) : output;
        const status = Number(split >= 0 ? output.slice(split + 1) : 0);
        if (code !== 0 || !status) {
          reject(new Error(Buffer.concat(stderr).toString('utf8') || 'Cloud request failed'));
          return;
        }
        resolve({ status, text: async () => value });
      });
      request.stdin.end(body);
    });
  };

  const delay = (milliseconds: number) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  const isBoschProxyPage = (value: string) =>
    /rbins\.bosch\.com|This site is forbidden inside Bosch|Network Error \(tcp_error\)/i.test(value);

  const cloudBaseRequest = async (pathname: string, init?: RequestInit) => {
    const target = `${CLOUDBASE_PHOTO_API}${pathname}`;
    const body = typeof init?.body === 'string' ? init.body : undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await curlRequest(
          target,
          init?.method || 'GET',
          [
            'Content-Type: application/json',
            ...(uploadToken ? [`X-Photo-Booth-Token: ${uploadToken}`] : []),
          ],
          body,
        );
        const value = await result.text();
        const retryable = [502, 503, 504].includes(result.status);
        if (!retryable || attempt === 3) {
          if (isBoschProxyPage(value)) {
            return {
              status: 503,
              text: async () => JSON.stringify({
                error: 'Bosch corporate proxy blocked Tencent Cloud',
                detail: '请切换非 Bosch 网络，或请 IT 放行 CloudBase API 域名。',
              }),
            };
          }
          return { status: result.status, text: async () => value };
        }
      } catch (error) {
        lastError = error;
        if (attempt === 3) throw error;
      }
      await delay(attempt * 500);
    }
    throw lastError;
  };

  const decodePortrait = (value: string) => {
    const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
    if (!match) throw new Error('Unreadable portrait image');
    return {
      mimeType: match[1].toLowerCase().replace('image/jpg', 'image/jpeg'),
      buffer: Buffer.from(match[2], 'base64'),
    };
  };

  interface CloudUploadDescriptor {
    variant: 'portrait' | 'source';
    cloudPath: string;
    url: string;
    token: string;
    authorization: string;
    fileId: string;
    cosFileId: string;
  }

  const uploadCloudObject = async (
    descriptor: CloudUploadDescriptor,
    image: { mimeType: string; buffer: Buffer },
  ) => {
    console.log(`[cloud-upload] storage-host=${new URL(descriptor.url).hostname}`);
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await curlRequest(
          descriptor.url,
          'PUT',
          [
            `Authorization: ${descriptor.authorization}`,
            `X-Cos-Security-Token: ${descriptor.token}`,
            `X-Cos-Meta-Fileid: ${descriptor.cosFileId}`,
            `key: ${encodeURIComponent(descriptor.cloudPath)}`,
            `Content-Type: ${image.mimeType}`,
          ],
          image.buffer,
        );
        const value = await result.text();
        if (result.status >= 200 && result.status < 300) return;
        if (isBoschProxyPage(value)) {
          throw new Error('Bosch corporate proxy blocked Tencent Cloud storage. 请切换非 Bosch 网络或申请域名白名单。');
        }
        lastError = new Error(`Cloud storage upload failed (${result.status}): ${value}`);
        if (![502, 503, 504].includes(result.status)) throw lastError;
      } catch (error) {
        lastError = error;
        if (
          error instanceof Error &&
          /Bosch corporate proxy blocked/.test(error.message)
        ) {
          throw error;
        }
      }
      if (attempt < 3) await delay(attempt * 500);
    }
    throw lastError;
  };

  const requireUploadToken: express.RequestHandler = (req, res, next) => {
    // In cloud-sync mode the browser talks only to localhost. The local Node
    // process attaches the secret when forwarding to the fixed CloudBase host.
    if (useCloudBase) return next();
    if (!uploadToken || req.get('X-Photo-Booth-Token') === uploadToken) return next();
    return res.status(401).json({ error: 'Invalid upload token' });
  };

  const broadcastWallMessage = (message: WallSocketMessage) => {
    const payload = JSON.stringify(message);
    wallWebSocket?.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
  };

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // Stored wall photos. A file here is written once under a name derived from
  // its entry id and never rewritten, so it can be cached indefinitely — that
  // is what keeps a wall reload or reconnect from re-downloading the room.
  // `fallthrough: false` makes a missing photo a 404 instead of letting the
  // SPA catch-all answer an <img> request with index.html.
  app.use(
    WALL_MEDIA_ROUTE,
    express.static(wallMediaDirectory(wallDataFile), {
      immutable: true,
      maxAge: "365d",
      fallthrough: false,
    }),
  );

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
  app.get("/api/wall/entries", async (_req, res) => {
    if (useCloudBase) {
      const remote = await cloudBaseRequest('/entries');
      return res.status(remote.status).send(await remote.text());
    }
    res.json(wallRepository.list());
  });

  app.get("/api/photos/:claimToken", (req, res) => {
    const { claimToken } = req.params;
    if (!/^[A-Za-z0-9_-]{24,64}$/.test(claimToken)) {
      return res.status(400).json({ error: "Invalid photo token" });
    }
    const entry = wallRepository.findByClaimToken(claimToken);
    if (!entry) return res.status(404).json({ error: "Photo not found" });
    res.json(entry);
  });

  app.get("/api/photos/:claimToken/download", (req, res) => {
    const { claimToken } = req.params;
    if (!/^[A-Za-z0-9_-]{24,64}$/.test(claimToken)) {
      return res.status(400).json({ error: "Invalid photo token" });
    }
    const entry = wallRepository.findByClaimToken(claimToken);
    if (!entry) return res.status(404).json({ error: "Photo not found" });
    const fileName = path.basename(entry.imageUrl);
    const filePath = path.join(wallMediaDirectory(wallDataFile), fileName);
    res.download(filePath, `Bosch-Supplier-Day-${entry.shortCode}${path.extname(fileName)}`);
  });

  app.post("/api/wall/codes", requireUploadToken, async (req, res) => {
    if (useCloudBase) {
      const remote = await cloudBaseRequest('/codes', {
        method: 'POST',
        body: JSON.stringify(req.body),
      });
      return res.status(remote.status).send(await remote.text());
    }
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

  app.post("/api/wall/entries", requireUploadToken, async (req, res) => {
    if (useCloudBase) {
      if (!isWallEntryDraft(req.body)) {
        return res.status(400).json({ error: "Invalid wall entry" });
      }
      try {
        const cloudStartedAt = Date.now();
        const portrait = decodePortrait(req.body.imageUrl);
        const source = req.body.sourceImageUrl
          ? decodePortrait(req.body.sourceImageUrl)
          : undefined;
        const requested = await cloudBaseRequest('/uploads', {
          method: 'POST',
          body: JSON.stringify({
            id: req.body.id,
            files: [{ variant: 'portrait', mimeType: portrait.mimeType }],
          }),
        });
        const requestedText = await requested.text();
        const presignMs = Date.now() - cloudStartedAt;
        if (requested.status < 200 || requested.status >= 300) {
          return res.status(requested.status).send(requestedText);
        }
        const descriptors = JSON.parse(requestedText) as CloudUploadDescriptor[];
        const portraitUpload = descriptors.find((item) => item.variant === 'portrait');
        if (!portraitUpload) throw new Error('Cloud storage did not return portrait upload');
        await uploadCloudObject(portraitUpload, portrait);
        const storageMs = Date.now() - cloudStartedAt - presignMs;
        const { imageUrl: _imageUrl, sourceImageUrl: _sourceImageUrl, ...metadata } = req.body;
        const remote = await cloudBaseRequest('/entries', {
          method: 'POST',
          body: JSON.stringify({
            ...metadata,
            imageFileId: portraitUpload.fileId,
          }),
        });
        console.log(
          `[cloud-upload] entry=${req.body.id} status=${remote.status} ` +
          `presign=${presignMs}ms storage=${storageMs}ms total=${Date.now() - cloudStartedAt}ms`,
        );
        const remoteText = await remote.text();
        if (source && remote.status >= 200 && remote.status < 300) {
          // The QR is ready now. Send the clean wall photo through a separate
          // background queue so it can never delay the guest's download.
          void (async () => {
            const queued = await cloudBaseRequest('/uploads', {
              method: 'POST',
              body: JSON.stringify({
                id: req.body.id,
                files: [{ variant: 'source', mimeType: source.mimeType }],
              }),
            });
            if (!queued.ok) throw new Error(`Wall upload reservation failed: ${queued.status}`);
            const queuedDescriptors = JSON.parse(await queued.text()) as CloudUploadDescriptor[];
            const sourceUpload = queuedDescriptors.find((item) => item.variant === 'source');
            if (!sourceUpload) throw new Error('Cloud storage did not return wall upload');
            await uploadCloudObject(sourceUpload, source);
            const attached = await cloudBaseRequest('/source', {
              method: 'POST',
              body: JSON.stringify({ id: req.body.id, sourceImageFileId: sourceUpload.fileId }),
            });
            if (!attached.ok) throw new Error(`Wall image attach failed: ${attached.status}`);
            console.log(`[wall-upload] entry=${req.body.id} queued upload complete`);
          })().catch((error) => console.error('[wall-upload] queued upload failed:', error));
        }
        return res.status(remote.status).send(remoteText);
      } catch (error) {
        console.error('[cloud-upload] failed:', error);
        return res.status(502).json({
          error: 'Cloud photo upload failed',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
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
      if (error instanceof Error && error.message === "WALL_MEDIA_INVALID") {
        return res.status(400).json({ error: "Unreadable portrait image" });
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
