"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const artifactSha256 = require("./artifact_sha256.cjs");

const root = path.resolve(__dirname, "..");
const browser = process.env.MERMAID_BROWSER || [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].find(candidate => fs.existsSync(candidate));
if (!browser) throw new Error("Set MERMAID_BROWSER to your installed Chromium or Edge executable.");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "category-architecture-"));
try {
  const config = path.join(scratch, "puppeteer.json");
  fs.writeFileSync(config, JSON.stringify({
    executablePath: browser,
    headless: true,
    args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check"],
  }));
  const cli = path.join(__dirname, "node_modules", "@mermaid-js", "mermaid-cli", "src", "cli.js");
  for (const format of ["svg", "png"]) {
    const output = path.join(root, "architecture", `production.${format}`);
    const result = spawnSync(process.execPath, [
      cli, "-i", path.join(root, "architecture", "production.mmd"),
      "-o", output, "-c", path.join(__dirname, "mermaid.config.json"),
      "-p", config, "-b", "#ffffff", "-w", "2000", "-s", "2",
    ], { stdio: "inherit", cwd: root });
    if (result.status !== 0) throw new Error(`Architecture ${format} render failed with exit code ${result.status}.`);
  }
  const hash = relative => artifactSha256(path.join(root, relative));
  fs.writeFileSync(path.join(root, "architecture", "production.render.json"), JSON.stringify({
    text_hash_normalization: "utf8-lf",
    source_sha256: hash(path.join("architecture", "production.mmd")),
    svg_sha256: hash(path.join("architecture", "production.svg")),
    png_sha256: hash(path.join("architecture", "production.png")),
    config_sha256: hash(path.join("presentation", "mermaid.config.json")),
    renderer: "@mermaid-js/mermaid-cli 11.17.0",
  }, null, 2) + "\n");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log("Generated architecture/production.svg and .png from the editable Mermaid source.");
