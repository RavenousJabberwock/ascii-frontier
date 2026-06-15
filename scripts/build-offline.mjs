#!/usr/bin/env node
// Builds a single self-contained HTML file containing the entire ASCII Frontier
// engine. No network, no React, no build step at runtime — just open the file.
//
// Usage: npm run build:offline
// Output: dist-offline/ascii-frontier-offline.html

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const entry = resolve(root, "src/game/voidwake.ts");
const outDir = resolve(root, "dist-offline");
const outFile = resolve(outDir, "ascii-frontier-offline.html");

mkdirSync(outDir, { recursive: true });

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  globalName: "VW",
  target: "es2020",
  minify: true,
  write: false,
  legalComments: "none",
  logLevel: "warning",
});

const js = result.outputFiles[0].text;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ASCII Frontier — Offline</title>
<meta name="description" content="ASCII Frontier — self-contained offline build. Single HTML file, no internet required.">
<style>
  html,body{margin:0;height:100%;background:#000;color:#0f0;font-family:monospace;overflow:hidden}
  body{display:flex;align-items:center;justify-content:center;padding:8px;box-sizing:border-box}
  canvas{height:95vh;width:100%;max-width:1400px;border:1px solid #064e3b;background:#000;display:block;outline:none}
</style>
</head>
<body>
  <canvas id="game" tabindex="0" aria-label="ASCII Frontier offline"></canvas>
  <script>
${js}
  var canvas=document.getElementById('game');
  var engine=new VW.Voidwake(canvas);
  engine.start();
  canvas.focus();
  window.addEventListener('beforeunload',function(){try{engine.stop()}catch(e){}});
  </script>
</body>
</html>`;

writeFileSync(outFile, html);
const kb = (html.length / 1024).toFixed(1);
console.log(`✓ Wrote ${outFile} (${kb} KB)`);
