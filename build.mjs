// Bundles the offscreen script (kokoro-js + transformers.js) and assembles dist/ for "Load unpacked".
import * as esbuild from "esbuild";
import fs from "fs";
import { execFileSync } from "child_process";

const DIST = "dist";
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(`${DIST}/ort`, { recursive: true });

await esbuild.build({
  entryPoints: ["src/offscreen.js"],
  outfile: `${DIST}/offscreen.bundle.js`,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  minify: true,
  logLevel: "warning",
});

for (const f of ["manifest.json", "background.js", "offscreen.html", "popup.html", "popup.js", "popup.css", "welcome.html", "welcome.js", "welcome.css"]) {
  fs.copyFileSync(`src/${f}`, `${DIST}/${f}`);
}

// onnxruntime-web loads these at runtime from env.wasmPaths; MV3 forbids fetching them from a CDN.
const ORT = "node_modules/onnxruntime-web/dist";
for (const f of fs.readdirSync(ORT)) {
  if (/^ort-wasm-simd-threaded(\.jsep)?\.(wasm|mjs)$/.test(f)) fs.copyFileSync(`${ORT}/${f}`, `${DIST}/ort/${f}`);
}

execFileSync("node", ["scripts/make-icons.mjs", `${DIST}/icons`], { stdio: "inherit" });
// Shareable zip: files at the root, so whatever folder the user's unzip creates is the one to load.
const { version } = JSON.parse(fs.readFileSync("src/manifest.json", "utf8"));
fs.mkdirSync("release", { recursive: true });
fs.rmSync("release/read-aloud.zip", { force: true });
execFileSync("zip", ["-qr", "-X", "../release/read-aloud.zip", "."], { cwd: DIST });
console.log(`Built dist/ and release/read-aloud.zip (v${version})`);
