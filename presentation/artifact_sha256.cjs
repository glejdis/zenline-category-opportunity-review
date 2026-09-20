"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

module.exports = function artifactSha256(filename) {
  const bytes = fs.readFileSync(filename);
  // Git may change text line endings between Windows and Linux checkouts.
  const content = [".mmd", ".svg", ".json"].includes(path.extname(filename).toLowerCase())
    ? bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
    : bytes;
  return createHash("sha256").update(content).digest("hex");
};
