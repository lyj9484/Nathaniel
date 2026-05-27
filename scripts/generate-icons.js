// Rasterize client/public/icon.svg into PNGs at PWA-required sizes.
// One-shot helper — run after editing icon.svg.
//
// Usage:  node scripts/generate-icons.js

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVG_PATH = path.join(__dirname, "..", "client", "public", "icon.svg");
const OUT_DIR = path.join(__dirname, "..", "client", "public");
const SIZES = [192, 512];

const svg = await readFile(SVG_PATH, "utf8");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><head><style>
       html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}
     </style></head><body>${svg}</body></html>`,
    { waitUntil: "domcontentloaded" },
  );
  const out = path.join(OUT_DIR, `icon-${size}.png`);
  await page.locator("svg").screenshot({ path: out, omitBackground: false });
  console.log("wrote", out);
}

await browser.close();
