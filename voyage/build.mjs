// Bundles the home page's sea into assets/voyage.js: three.js, GSAP and the scene code in src/.
// Run from this folder: npm ci, then node build.mjs, then python3 build.py from the repo root.
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "../assets/voyage.js",
  legalComments: "eof",
  metafile: true,
});
const out = Object.values(result.metafile.outputs)[0];
console.log("assets/voyage.js", (out.bytes / 1024).toFixed(0) + " KB");
