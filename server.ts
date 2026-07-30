import express from "express";
import path from "path";
import cors from "cors";
import fs from "fs";
import os from "os";
import http from "http";
import https from "https";
import { execFile } from "child_process";
import { createServer as createViteServer } from "vite";

import { PRINT_6INCH_SERVER } from "./constants";
import { ensureHttpsCert } from "./scripts/ensure-https-cert.mjs";
import type { PortraitRecord } from "./types";

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
  const portraits: PortraitRecord[] = [];
  const portraitStreams = new Set<express.Response>();

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // Booth → server → wall. Results live in memory for the event session and
  // the client keeps a local fallback if the wall runs on the same device.
  app.get("/api/portraits", (_req, res) => {
    res.json(portraits);
  });

  app.post("/api/portraits", (req, res) => {
    const record = req.body as Partial<PortraitRecord>;
    if (
      typeof record.id !== "string" ||
      typeof record.imageData !== "string" ||
      !record.imageData.startsWith("data:image/") ||
      typeof record.timestamp !== "number" ||
      typeof record.primary !== "string" ||
      typeof record.secondary !== "string"
    ) {
      return res.status(400).json({ error: "Invalid portrait record" });
    }

    const portrait = record as PortraitRecord;
    const existing = portraits.findIndex((item) => item.id === portrait.id);
    if (existing >= 0) portraits.splice(existing, 1);
    portraits.push(portrait);
    if (portraits.length > 48) portraits.splice(0, portraits.length - 48);

    const event = `event: portrait\ndata: ${JSON.stringify(portrait)}\n\n`;
    portraitStreams.forEach((stream) => stream.write(event));
    res.status(201).json({ success: true, id: portrait.id });
  });

  app.get("/api/portraits/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write("event: connected\ndata: {}\n\n");
    portraitStreams.add(res);

    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 20000);
    req.on("close", () => {
      clearInterval(keepAlive);
      portraitStreams.delete(res);
    });
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
