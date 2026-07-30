import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function lanIpv4s() {
  const addresses = [];
  for (const networks of Object.values(os.networkInterfaces())) {
    for (const network of networks || []) {
      if (network.family === "IPv4" && !network.internal) addresses.push(network.address);
    }
  }
  return addresses;
}

export function ensureHttpsCert() {
  const certDirectory = path.join(process.cwd(), ".cert");
  const keyPath = path.join(certDirectory, "localhost-key.pem");
  const certPath = path.join(certDirectory, "localhost.pem");
  const ips = lanIpv4s();

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { keyPath, certPath, ips, reused: true };
  }

  fs.mkdirSync(certDirectory, { recursive: true });
  const san = ["DNS:localhost", "IP:127.0.0.1", ...ips.map((ip) => `IP:${ip}`)].join(",");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "365",
    "-subj",
    "/CN=localhost",
    "-addext",
    `subjectAltName=${san}`,
    "-keyout",
    keyPath,
    "-out",
    certPath,
  ]);
  return { keyPath, certPath, ips, reused: false };
}

if (process.argv[1] && path.basename(process.argv[1]) === "ensure-https-cert.mjs") {
  const result = ensureHttpsCert();
  console.log(result.reused ? "Certificate already exists." : "Certificate created.");
}
