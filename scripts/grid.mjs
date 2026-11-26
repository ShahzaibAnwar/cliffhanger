#!/usr/bin/env node
/* Coordinate grid for an image, so annotations land on the right spot instead of being guessed.
     node grid.mjs <image> [--step 0.1] [--out file.jpg]
   Writes <image>_grid.jpg with lines every 10% labelled as fractions (0.0–1.0, what lens fx/fy use)
   and in source pixels. Open it, read the point you want (a face, a hand, the part to circle), and put
   those numbers in reel.json. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const a = process.argv.slice(2), opt = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
const src = a.find(x => !x.startsWith('--') && x !== opt('step') && x !== opt('out'));
if (!src || !fs.existsSync(src)) { console.error('usage: node grid.mjs <image> [--step 0.1] [--out file.jpg]'); process.exit(1); }
const img = path.resolve(src);
const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', img], { encoding: 'utf8' });
const [w, h] = (probe.stdout || '').trim().split('x').map(Number);
if (!w || !h) { console.error('could not read image size'); process.exit(1); }
const step = Math.min(0.5, Math.max(0.02, parseFloat(opt('step', '0.1'))));
const out = path.resolve(opt('out', img.replace(/\.[^.]+$/, '') + '_grid.jpg'));

// draw at a readable size: long side 1400 px, labels in source pixels
const k = 1400 / Math.max(w, h), W = Math.round(w * k), H = Math.round(h * k);
let lines = '';
for (let i = 0, f = 0; f <= 1.0001; i++, f = +(i * step).toFixed(4)) {
  const major = Math.round(f * 100) % 50 === 0, x = f * W, y = f * H, col = major ? '#e0262b' : 'rgba(224,38,43,.55)';
  lines += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${col}" stroke-width="${major ? 2 : 1}"/>`;
  lines += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${major ? '#1f5fd6' : 'rgba(31,95,214,.55)'}" stroke-width="${major ? 2 : 1}"/>`;
  if (f < 1) {
    lines += `<text x="${x + 4}" y="16" fill="#e0262b">${f.toFixed(2)} · ${Math.round(f * w)}</text>`;
    lines += `<text x="4" y="${y + 16}" fill="#1f5fd6">${f.toFixed(2)} · ${Math.round(f * h)}</text>`;
  }
}
const html = `<!doctype html><html><body style="margin:0;background:#fff"><div style="position:relative;width:${W}px;height:${H}px">
<img src="${pathToFileURL(img).href}" style="width:${W}px;height:${H}px;display:block">
<svg width="${W}" height="${H}" style="position:absolute;inset:0;font:600 13px monospace;paint-order:stroke;stroke-linejoin:round">
<style>text{stroke:#fff;stroke-width:3px}</style>${lines}</svg></div></body></html>`;
const tmp = path.join(path.dirname(out), `.grid-${process.pid}.html`);
fs.writeFileSync(tmp, html);
const { chromium } = await import('playwright-core');
let browser; for (const o of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) { try { browser = await chromium.launch(o); break; } catch { /* next */ } }
if (!browser) { fs.rmSync(tmp, { force: true }); console.error('No Chromium found. Install Google Chrome or set CHROME_PATH.'); process.exit(1); }
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
  await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
} finally { await browser.close(); fs.rmSync(tmp, { force: true }); }
console.log(JSON.stringify({ grid: out, width: w, height: h, step }));
