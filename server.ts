import express from "express";
import path from "path";
import cors from "cors";
import fs from "fs";
import os from "os";
import http from "http";
import https from "https";
import { exec } from "child_process";
import { createServer as createViteServer } from "vite";

import { PRINT_6INCH_SERVER } from "./constants";
import { ensureHttpsCert } from "./scripts/ensure-https-cert.mjs";

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
  const PORT = Number(process.env.PORT || 3000);
  const useHttps = wantsHttps();

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // API endpoint for silent printing (6-inch / 6x4)
  app.post("/api/print", (req, res) => {
    const { imageBase64, printerName, printSize } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "No imageBase64 provided" });
    }

    try {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const tempFileName = `print_${Date.now()}.jpg`;
      const tempFilePath = path.join(os.tmpdir(), tempFileName);

      fs.writeFileSync(tempFilePath, base64Data, "base64");
      console.log(`Saved temporary image for printing: ${tempFilePath}`);

      const isWindows = os.platform() === "win32";
      let cmd = "";

      if (isWindows) {
        if (printerName) {
          cmd = `mspaint /pt "${tempFilePath}" "${printerName}"`;
        } else {
          cmd = `mspaint /p "${tempFilePath}"`;
        }
      } else {
        const mediaFlag =
          printSize === PRINT_6INCH_SERVER.media || printSize === "6x4"
            ? `-o media=${PRINT_6INCH_SERVER.media} `
            : "";
        if (printerName) {
          cmd = `lpr -P "${printerName}" ${mediaFlag}"${tempFilePath}"`;
        } else {
          cmd = `lpr ${mediaFlag}"${tempFilePath}"`;
        }
      }

      console.log(`Executing print command (size: ${printSize || PRINT_6INCH_SERVER.media}): ${cmd}`);

      exec(cmd, (error, stdout, stderr) => {
        if (error) console.error(`Print error: ${error.message}`);
        if (stderr) console.error(`Print stderr: ${stderr}`);
        console.log(`Print complete. Output: ${stdout}`);
        setTimeout(() => {
          try {
            fs.unlinkSync(tempFilePath);
          } catch {
            // ignore
          }
        }, 10000);
      });

      res.json({
        success: true,
        message: "Print job submitted to queue.",
        size: printSize || PRINT_6INCH_SERVER.media,
      });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
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
      app
    );
    console.log(reused ? `TLS: reusing ${keyPath}` : `TLS: generated cert for ${ips.join(", ")}`);
  } else {
    server = http.createServer(app);
  }

  // Vite middleware for development
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
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const proto = useHttps ? "https" : "http";
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on ${proto}://localhost:${PORT}`);
    console.log(`  Booth (拍照): ${proto}://localhost:${PORT}/booth`);
    console.log(`  Wall  (大屏): ${proto}://localhost:${PORT}/wall`);
    for (const ip of lanIpv4s()) {
      console.log(`  LAN Booth: ${proto}://${ip}:${PORT}/booth`);
      console.log(`  LAN Wall:  ${proto}://${ip}:${PORT}/wall`);
    }
    if (useHttps) {
      console.log("Note: self-signed cert — browser will warn; click Advanced → Proceed.");
      console.log("Camera on phones/tablets needs HTTPS (or localhost).");
    }
    console.log(`Silent Printing Endpoint: POST ${proto}://localhost:${PORT}/api/print`);
  });
}

startServer();
